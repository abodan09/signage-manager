/* OneDrive folder slideshow, plus the OAuth machinery it is the first to need:
   PKCE, the loopback listener, and refreshing a token before it expires.

   Graph and Microsoft's token endpoint are stubbed at the fetch boundary. */
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`
const { JsonDB } = require(`${DIST}/database.js`)
const { AppStore } = require(`${DIST}/apps/store.js`)
const { getApp } = require(`${DIST}/apps/registry.js`)
const { sanitizeAppConfig } = require(`${DIST}/apps/schema.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)
const { makePkce, awaitCode } = require(`${DIST}/oauth/loopback.js`)
const { folderPathProblem, parseFolderRef } = require(`${DIST}/apps/onedrive/index.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

// ── stub Graph and the token endpoint ───────────────────────────────────────
const realFetch = globalThis.fetch
let graphCalls = []
let tokenCalls = []
let graphStatus = 200
let files = []
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || ''
  if (url.indexOf('https://graph.microsoft.com') === 0) {
    graphCalls.push({ url, auth: (init && init.headers && init.headers.authorization) || '' })
    if (graphStatus !== 200) return new Response('{}', { status: graphStatus })
    return new Response(JSON.stringify({ value: files }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  if (url.indexOf('https://login.microsoftonline.com') === 0) {
    tokenCalls.push(String(init && init.body))
    return new Response(JSON.stringify({
      access_token: 'fresh-token', refresh_token: 'fresh-refresh', expires_in: 3600,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (url.indexOf('https://files.example/') === 0) {
    return new Response(Buffer.from('ffd8ffe000104a46', 'hex'), {
      status: 200, headers: { 'content-type': 'image/jpeg' },
    })
  }
  return realFetch(input, init)
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-od-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const od = getApp('onedrive')
const CLIENT = '11111111-2222-3333-4444-555555555555'
const item = (o = {}) => ({
  id: 'd1', name: 'a.jpg', size: 1000, lastModifiedDateTime: '2026-01-01T00:00:00Z',
  cTag: 'c1', file: { mimeType: 'image/jpeg' },
  '@microsoft.graph.downloadUrl': 'https://files.example/a.jpg', ...o,
})

const server = app.listen(0, async () => {
  const base = lanUrl()
  const call = async (m, u, b) => {
    const res = await fetch(base + u, {
      method: m, headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, body: json }
  }

  console.log('\n=== registration ===')

  check('onedrive is registered', !!od)
  // sharepoint owns 'microsoft'; connections are one record per provider, so
  // sharing the key would make signing out of one sign the other out too.
  check('it does not share sharepoint\'s provider key', od.provider === 'onedrive')
  check('it fetches on a schedule', typeof od.refresh === 'function')

  console.log('\n=== the folder path ===')

  check('empty means the top of the drive', parseFolderRef('').kind === 'root')
  check('a path is kept', parseFolderRef('Signage/Lobby').value === 'Signage/Lobby')
  check('stray slashes are trimmed', parseFolderRef('/Signage/Lobby/').value === 'Signage/Lobby')
  check('a pasted link is refused with advice',
    /not a link/i.test(folderPathProblem('https://onedrive.live.com/x') || ''))
  check('illegal characters are refused', !!folderPathProblem('bad:name'))
  check('a plain path is fine', folderPathProblem('Signage/Lobby') === null)

  console.log('\n=== proof key ===')

  const p1 = makePkce(), p2 = makePkce()
  check('a verifier is generated', p1.verifier.length >= 43)
  check('and is different every time', p1.verifier !== p2.verifier)
  check('the challenge is not the verifier', p1.challenge !== p1.verifier)
  check('it is url-safe base64', !/[+/=]/.test(p1.challenge))
  // A desktop app ships to customers, so anything in the binary is public.
  // The proof key is what makes an intercepted code worthless.
  const crypto = require('crypto')
  check('the challenge is the sha256 of the verifier',
    p1.challenge === crypto.createHash('sha256').update(p1.verifier).digest('base64url'))

  console.log('\n=== the loopback listener ===')

  let seenUrl = ''
  // The handler is attached immediately: this flow is expected to reject, and
  // a rejection with no handler yet takes the whole process down.
  const codePromise = awaitCode({
    open: u => { seenUrl = u },
    authorizeUrl: (redirect, state) => `https://auth.example/go?redirect_uri=${encodeURIComponent(redirect)}&state=${state}`,
    timeoutMs: 8000,
  }).then(() => null, e => e.message)
  await new Promise(r => setTimeout(r, 300))
  const redirect = decodeURIComponent(/redirect_uri=([^&]+)/.exec(seenUrl)[1])
  const state = /state=([^&]+)/.exec(seenUrl)[1]

  // This product already runs an Express server deliberately exposed to the
  // LAN. This listener must not be, or a device on the network could answer
  // the redirect and take the code.
  check('the listener is on loopback only', redirect.indexOf('http://127.0.0.1:') === 0, redirect)
  check('and on an OS-assigned port', /:\d+$/.test(redirect))

  const wrongState = await fetch(`${redirect}/?code=abc&state=not-the-state`)
  check('a mismatched state is refused', wrongState.status === 200)
  const rejected = await codePromise
  check('and the flow fails rather than accepting the code',
    /did not match/i.test(rejected || ''), rejected)

  // Now the happy path.
  let url2 = ''
  const good = awaitCode({
    open: u => { url2 = u },
    authorizeUrl: (redirect, state) => `https://auth.example/go?redirect_uri=${encodeURIComponent(redirect)}&state=${state}`,
    timeoutMs: 8000,
  })
  await new Promise(r => setTimeout(r, 300))
  const r2 = decodeURIComponent(/redirect_uri=([^&]+)/.exec(url2)[1])
  const s2 = /state=([^&]+)/.exec(url2)[1]
  await fetch(`${r2}/?code=the-code&state=${s2}`)
  const got = await good
  check('a matching state yields the code', got.code === 'the-code')
  check('and reports the address it listened on', got.redirectUri === r2)

  console.log('\n=== the client id ===')

  const badId = await call('POST', '/api/apps/connections/onedrive/key', { key: 'nope' })
  check('a rubbish client id is refused', badId.status === 400)
  check('and the message says what one looks like', /36-character/.test(badId.body.error || ''))
  const okId = await call('POST', '/api/apps/connections/onedrive/key', { key: CLIENT })
  check('a real client id is stored', okId.status === 200, okId.body)

  // A client id on file is not a sign-in: nothing can be fetched with it yet.
  const made = await call('POST', '/api/apps/instances', {
    appId: 'onedrive', name: 'Lobby', config: { folderPath: 'Signage/Lobby' },
  })
  check('an instance saves', made.status === 201, made.body)
  const listed = await call('GET', '/api/apps/instances')
  const mine = listed.body.instances.find(i => i.id === made.body.instance.id)
  check('a stored client id alone still counts as not connected',
    mine.needsConnection === true)

  const noAuth = await call('POST', '/api/apps/connections/onedrive/signin')
  check('signing in works once an id is on file', noAuth.status === 202, noAuth.body)

  console.log('\n=== reading the folder ===')

  apps.setConnection({
    provider: 'onedrive', accountName: 'Signed in',
    accessToken: 'live-token', refreshToken: 'r1',
    expiresAt: Date.now() + 3600_000,
    connectedAt: new Date().toISOString(),
    meta: { kind: 'oauth', clientId: CLIENT },
  })
  const after = await call('GET', '/api/apps/instances')
  check('signing in clears the badge',
    after.body.instances.find(i => i.id === made.body.instance.id).needsConnection === false)

  files = [
    item({ id: 'd1', name: '1.jpg' }),
    item({ id: 'd2', name: '2.mp4', file: { mimeType: 'video/mp4' } }),
    item({ id: 'd3', name: 'Sub', file: undefined, folder: { childCount: 2 } }),
  ]
  graphCalls = []
  const refreshed = await call('POST', `/api/apps/instances/${made.body.instance.id}/refresh`)
  check('the folder is read', refreshed.status === 200, refreshed.body)
  check('graph was called', graphCalls.length >= 1)
  check('with a bearer token', /^Bearer /.test(graphCalls[0].auth))
  // Files.Read is the scope an ordinary person can agree to; the .All variants
  // need an administrator in a typical tenant.
  check('the folder path is addressed by path, not id',
    /root:\/Signage\/Lobby:\/children/.test(graphCalls[0].url), graphCalls[0].url)

  const data = await call('GET', `/tv/app/${made.body.instance.id}/data`)
  const items = data.body.data.items
  check('the pictures and video are used', items.length === 2, items)
  check('a subfolder is not treated as a file', !items.some(i => i.name === 'Sub'))
  check('media paths are relative to the manager', items[0].src.indexOf('/app-media/') === 0)

  console.log('\n=== keeping the sign-in alive ===')

  // Refreshed early rather than on failure: a sync that starts with seconds
  // left would die halfway through copying a folder.
  apps.setConnection({
    provider: 'onedrive', accountName: 'Signed in',
    accessToken: 'stale-token', refreshToken: 'r1',
    expiresAt: Date.now() + 60_000,
    connectedAt: new Date().toISOString(),
    meta: { kind: 'oauth', clientId: CLIENT },
  })
  tokenCalls = []
  graphCalls = []
  await call('POST', `/api/apps/instances/${made.body.instance.id}/refresh`)
  check('a token near expiry is refreshed first', tokenCalls.length === 1)
  check('using the refresh grant', /grant_type=refresh_token/.test(tokenCalls[0] || ''))
  check('and the new token is used', /Bearer fresh-token/.test(graphCalls[0]?.auth || ''))
  const stored = apps.getConnection('onedrive')
  check('the new token is kept', stored.accessToken === 'fresh-token')
  check('and so is the rotated refresh token', stored.refreshToken === 'fresh-refresh')
  // A token refresh is not an account change: invalidating here would throw
  // the mirrored folder away every hour.
  const still = apps.getCached(made.body.instance.id)
  check('refreshing a token does not throw the folder away', !!still && !!still.data)

  tokenCalls = []
  await call('POST', `/api/apps/instances/${made.body.instance.id}/refresh`)
  check('a healthy token is not refreshed again', tokenCalls.length === 0)

  console.log('\n=== when microsoft says no ===')

  graphStatus = 401
  const expired = await call('POST', `/api/apps/instances/${made.body.instance.id}/refresh`)
  check('an expired sign-in is reported', expired.status === 502)
  check('in words an operator can act on',
    /sign in again/i.test(expired.body.error || ''), expired.body.error)
  // The store keeps the last good payload on screen through a failure.
  const survived = await call('GET', `/tv/app/${made.body.instance.id}/data`)
  check('and the wall keeps playing what it had', survived.body.data.items.length === 2)
  graphStatus = 200

  console.log('\n=== the page ===')

  const page = await (await fetch(`${base}/tv/app/${made.body.instance.id}`)).text()
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|await |\?\?|\?\./.test(scripts))
  check('the crossfade uses opacity, never a transform', !/transform/.test(page))
  check('no flex gap', !/[^-]gap\s*:/.test(page))
  check('it never reports itself finished', !/signage:ended/.test(page))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
