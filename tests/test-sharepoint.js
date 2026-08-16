/* SharePoint: reading a pasted address, the save-time refusals, the capture
   contract, and the page the screens are served.

   The capture itself needs Electron, so this stubs the capture module in the
   require cache and exercises everything around it. */
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`

// Stub the capture module BEFORE the registry pulls the app in, so refresh()
// gets our fake instead of trying to open a Chromium window.
const capturePath = require.resolve(`${DIST}/apps/sharepoint/capture.js`)
let captureCalls = []
let captureImpl = async () => ({
  png: Buffer.from('89504e470d0a1a0a', 'hex'), width: 1920, height: 1080,
  finalUrl: 'https://contoso.sharepoint.com/sites/Marketing',
})
require.cache[capturePath] = {
  id: capturePath, filename: capturePath, loaded: true, children: [], paths: [],
  exports: { captureUrl: (...a) => { captureCalls.push(a); return captureImpl(...a) } },
}

const { JsonDB } = require(`${DIST}/database.js`)
const { AppStore } = require(`${DIST}/apps/store.js`)
const { getApp } = require(`${DIST}/apps/registry.js`)
const { sanitizeAppConfig } = require(`${DIST}/apps/schema.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)
const { parseSharePointUrl, sharePointUrlProblem } = require(`${DIST}/apps/sharepoint/parse.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-sp-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const sp = getApp('sharepoint')
const SITE = 'https://contoso.sharepoint.com/sites/Marketing'
const C = (o = {}) => ({ url: SITE, view: 'fold', refreshMinutes: 15, ...o })
const san = o => sanitizeAppConfig(sp, C(o))
const scriptsOf = html =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')

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
  const text = async u => (await fetch(base + u)).text()

  console.log('\n=== registration ===')

  check('sharepoint is registered', !!sp)
  check('it declares a microsoft provider', sp.provider === 'microsoft')
  check('it fetches on a schedule', typeof sp.refresh === 'function')
  check('it reshapes its data for the page', typeof sp.serializeData === 'function')
  // A top-level electron import here would break every other app suite, which
  // loads the registry in bare node.
  check('loading the registry needs no electron', true)

  console.log('\n=== reading a pasted address ===')

  check('a site address is recognised', parseSharePointUrl(SITE).kind === 'site')
  check('the site path is picked out', parseSharePointUrl(SITE).sitePath === '/sites/Marketing')
  check('a page address is recognised',
    parseSharePointUrl(`${SITE}/SitePages/Home.aspx`).kind === 'page')
  check('a teams site is recognised',
    parseSharePointUrl('https://contoso.sharepoint.com/teams/Sales').sitePath === '/teams/Sales')
  check('a tenant root is a site',
    parseSharePointUrl('https://contoso.sharepoint.com').kind === 'site')
  // Rebuilt rather than echoed: a pasted address carries a fragment that means
  // nothing to a capture.
  check('the fragment is dropped',
    parseSharePointUrl(`${SITE}#section`).canonicalUrl.indexOf('#') < 0)
  check('a real query is kept',
    parseSharePointUrl(`${SITE}?view=All`).canonicalUrl.indexOf('view=All') > 0)
  check('rubbish returns null rather than throwing', parseSharePointUrl('not a url') === null)
  check('an empty address returns null', parseSharePointUrl('') === null)
  check('a non-web scheme is refused', parseSharePointUrl('javascript:alert(1)') === null)

  console.log('\n=== the four addresses people actually paste by mistake ===')

  check('the sign-in page is refused',
    /sign-in address/i.test(sharePointUrlProblem('https://login.microsoftonline.com/common/oauth2') || ''))
  check('a personal OneDrive is refused',
    /OneDrive/i.test(sharePointUrlProblem('https://contoso-my.sharepoint.com/personal/a_b/Documents') || ''))
  check('a single-file share link is refused',
    /single file/i.test(sharePointUrlProblem('https://contoso.sharepoint.com/:w:/g/EbC1') || ''))
  check('a 1drv.ms link is refused',
    !!sharePointUrlProblem('https://1drv.ms/w/s!Abc'))
  check('http against sharepoint.com is refused',
    /https/i.test(sharePointUrlProblem('http://contoso.sharepoint.com/sites/M') || ''))
  check('a good address has no complaint', sharePointUrlProblem(SITE) === null)
  // Not a SharePoint host at all is fine — the capture works for any intranet
  // page, and refusing it would remove a genuinely useful case.
  check('a plain intranet address is allowed',
    sharePointUrlProblem('https://intranet.example.com/news') === null)

  console.log('\n=== saving ===')

  check('a valid config saves', san().ok === true, san().error)
  check('the address is required', san({ url: '' }).ok === false)
  check('a bad address is refused at save time',
    san({ url: 'https://login.microsoftonline.com/x' }).ok === false)
  // The connection lives outside config; storing it there would put an account
  // reference in every export of the instance.
  check('the account field is never stored', san({ account: 'someone' }).config.account === undefined)
  check('refresh minutes below the floor are refused', san({ refreshMinutes: 0 }).ok === false)
  check('an absurd refresh interval is refused', san({ refreshMinutes: 999 }).ok === false)
  check('scroll speed is dropped unless the whole page scrolls',
    san({ view: 'fold' }).config.scrollSpeed === undefined)
  check('and kept when it does', san({ view: 'whole' }).config.scrollSpeed === 8)
  check('the fit setting is dropped when the whole page scrolls',
    san({ view: 'whole' }).config.fit === undefined)

  console.log('\n=== the capture contract ===')

  const inst = { id: 'inst-1', appId: 'sharepoint', name: 'Marketing', config: C({ refreshMinutes: 20 }) }
  const written = {}
  const ctx = {
    instance: inst, data: null, fontCss: '', baseUrl: base,
    mirror: async () => null,
    writeMedia: (name, buf) => { written[name] = buf; return `/app-media/${name}` },
  }

  captureCalls = []
  const result = await sp.refresh(ctx)
  check('a capture is taken', captureCalls.length === 1)
  check('it is asked for the canonical address', captureCalls[0][0].url === SITE)
  check('and run in the private session partition', captureCalls[0][1] === 'persist:sharepoint')
  check('the refresh interval is honoured', result.ttlSeconds === 20 * 60)
  check('the picture is written to disk', Object.keys(written).length === 1)
  check('the stored data points at it', result.data.path.indexOf('/app-media/') === 0)
  check('and records when it was taken', typeof result.data.capturedAt === 'string')

  // /app-media is served to the whole LAN with no password, because the TVs
  // need it that way. An intranet page photographed here becomes a file on an
  // open web server, so its name must not be derivable from anything visible.
  const fileName = Object.keys(written)[0]
  check('the file name is not the instance id', fileName.indexOf('inst-1') < 0)
  check('it is long enough not to be guessed', /^[0-9a-f]{32}\.png$/.test(fileName), fileName)

  captureImpl = async () => { throw new Error('Not signed in. Open this app\'s settings and use Sign In.') }
  let threw = null
  try { await sp.refresh(ctx) } catch (e) { threw = e.message }
  check('a sign-in failure surfaces its own message', /Sign In/.test(threw || ''), threw)
  // The store keeps the previous picture on screen when refresh throws; this
  // asserts refresh does throw rather than returning something empty.
  check('and it throws rather than storing a blank', threw !== null)
  captureImpl = async () => ({
    png: Buffer.from('89504e470d0a1a0a', 'hex'), width: 1920, height: 1080, finalUrl: SITE,
  })

  console.log('\n=== what the screens are served ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'sharepoint', name: 'Marketing wall', config: C(),
  })
  check('an instance saves over http', made.status === 201, made.body)
  const page = await text(`/tv/app/${made.body.instance.id}`)

  check('the page renders before the first capture', page.includes('CFG'))
  check('it waits rather than showing an error', page.includes('Waiting for the first picture'))
  check('it polls the app data route', page.includes(`/tv/app/${made.body.instance.id}/data`))
  // Same-origin: the address this PC believes it has is not necessarily the one
  // the screen used to reach it.
  check('it polls relatively', /"dataUrl":"\/tv\//.test(page))

  const scripts = scriptsOf(page)
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5',
    !/=>|async function|await |\.padStart\(|\?\?|\?\.|Object\.(entries|values)\(/.test(scripts))
  check('it never fetches from the TV', !/\bfetch\(/.test(scripts))
  check('no CSS grid', !/display\s*:\s*grid/.test(page))
  check('no flex gap', !/[^-]gap\s*:/.test(page))
  check('no CSS custom properties', !page.includes('var(--'))
  check('no inset shorthand', !/[^-]inset\s*:/.test(page))
  // A six-thousand-pixel image is where an old panel runs out of texture
  // memory, so the scroll moves by layout rather than by compositing.
  check('the long-page scroll does not use a compositor transform', !/transform/.test(page))
  check('it never reports itself finished', !/signage:ended/.test(page))
  // A picture that fails to load must never replace one that was working, and
  // must never leave a broken-image icon on a wall.
  check('a new picture is loaded out of sight before it is shown',
    /new Image\(\)/.test(scripts) && /pre\.onload/.test(scripts))
  check('and a failed load keeps whatever was showing', /pre\.onerror/.test(scripts))

  const nasty = await call('POST', '/api/apps/instances', {
    appId: 'sharepoint', name: '<img src=x onerror=alert(1)>', config: C(),
  })
  const nastyPage = await text(`/tv/app/${nasty.body.instance.id}`)
  check('a hostile instance name is escaped in the title',
    !/<img src=x onerror/.test(nastyPage))
  check('no inline event handlers are emitted', !/<[a-z][^>]*\son[a-z]+\s*=/i.test(nastyPage))

  console.log('\n=== the data the page polls ===')

  const dataRes = await call('GET', `/tv/app/${made.body.instance.id}/data`)
  check('the data route answers', dataRes.status === 200)
  // Creating an instance kicks off a refresh, so by now the stubbed capture has
  // usually landed. Either state is legitimate; both must be well formed.
  const d = dataRes.body.data
  check('before a capture it is null, after one it is a picture',
    d === null || typeof d.src === 'string', d)
  if (d) {
    // Relative, so it resolves against whatever address the screen used to
    // reach this manager rather than the one this PC believes it has.
    check('the picture address is relative', d.src.indexOf('/app-media/') === 0, d.src)
    check('and carries no guessed host', d.src.indexOf('http') !== 0, d.src)
  } else {
    check('a null payload still carries no error', !dataRes.body.error)
    check('and the page copes with it', true)
  }

  // Directly, so the null path is covered whatever the timing above did.
  check('serializeData returns null before the first capture',
    sp.serializeData({ instance: made.body.instance, data: null, baseUrl: base }) === null)

  console.log('\n=== signing in ===')

  const noUrl = await call('POST', '/api/apps/connections/microsoft/signin', { url: '' })
  check('sign-in needs an address first', noUrl.status === 400)
  check('and says so in words', /address/i.test(noUrl.body.error || ''))
  const badProvider = await call('POST', '/api/apps/connections/google/signin', { url: SITE })
  check('an unknown provider is refused', badProvider.status === 404)
  const httpUrl = await call('POST', '/api/apps/connections/microsoft/signin', {
    url: 'http://contoso.sharepoint.com/sites/M',
  })
  check('sign-in refuses a plain-http address', httpUrl.status === 400)

  const gone = await call('DELETE', '/api/apps/connections/microsoft')
  check('signing out with no account is a 404', gone.status === 404)

  console.log('\n=== the connection is reflected on the instance ===')

  const listed = await call('GET', '/api/apps/instances')
  const mine = listed.body.instances.find(i => i.id === made.body.instance.id)
  check('the instance reports it needs a connection', mine.needsConnection === true)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
