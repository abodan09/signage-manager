/* The apps framework and the Instagram app: schema validation, instance CRUD,
   caching and stale-serving, the rendered page's TV-compat floor, media
   mirroring, and the playlist plumbing. */
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`
const { JsonDB } = require(`${DIST}/database.js`)
const { AppStore } = require(`${DIST}/apps/store.js`)
const { getApp, APPS } = require(`${DIST}/apps/registry.js`)
const { sanitizeAppConfig, publicDefinition } = require(`${DIST}/apps/schema.js`)
const { applyFilter } = require(`${DIST}/apps/social/sources.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { createContentRouter } = require(`${DIST}/routes/content.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-apps-'))
fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true })
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const tvClients = new Map()
const pushed = []
tvClients.set('tv1', { readyState: 1, send: m => pushed.push(JSON.parse(m)), close() {} })

// A stand-in for the hosted feed service. Serves one image so the mirror has
// something real to copy, and can be told to fail so stale-serving is testable.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')
let feedFails = false
let feedHits = 0
const upstream = http.createServer((req, res) => {
  if (req.url.startsWith('/img')) {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    res.end(PNG); return
  }
  feedHits++
  if (feedFails) { res.writeHead(503); res.end('{"message":"upstream down"}'); return }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    username: 'copperskillet',
    fullName: 'The Copper Skillet',
    profilePictureUrl: `http://127.0.0.1:${upstream.address().port}/img/avatar.png`,
    followersCount: 4821,
    posts: [
      { id: 'p1', mediaType: 'IMAGE', mediaUrl: `http://127.0.0.1:${upstream.address().port}/img/1.png`,
        caption: 'Fresh sourdough out of the oven #bread', timestamp: new Date(Date.now() - 3600e3).toISOString(),
        permalink: 'https://instagram.com/p/1', width: 1080, height: 1350 },
      { id: 'p2', mediaType: 'VIDEO', mediaUrl: `http://127.0.0.1:${upstream.address().port}/img/2.mp4`,
        thumbnailUrl: `http://127.0.0.1:${upstream.address().port}/img/2.png`,
        caption: 'Behind the pass', timestamp: new Date(Date.now() - 86400e3 * 40).toISOString(), width: 1080, height: 1080 },
      { id: 'p3', mediaType: 'IMAGE', mediaUrl: `http://127.0.0.1:${upstream.address().port}/img/3.png`,
        caption: 'Sunday roast is back', timestamp: new Date(Date.now() - 86400e3 * 2).toISOString(), width: 1350, height: 1080 },
    ],
  }))
})

const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
// Mounted exactly as startServer() does, so the mirrored-media path under test
// is the one screens actually load from.
app.use('/app-media', express.static(apps.mediaPath))
app.use('/api/apps', createAppsRouter(db, apps, tvClients, lanUrl))
app.use('/api/content', createContentRouter(db, path.join(dir, 'uploads'), {}, tvClients))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const server = app.listen(0, () => upstream.listen(0, async () => {
  const base = lanUrl()
  const FEED = `http://127.0.0.1:${upstream.address().port}/feed.json`
  const call = async (m, u, b) => {
    const res = await fetch(base + u, {
      method: m, headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, body: json }
  }
  const text = async u => (await fetch(base + u)).text()

  console.log('\n=== the schema validates every app the same way ===')

  const ig = getApp('instagram')
  check('instagram is registered', !!ig)
  check('every app declares an icon, a category and fields',
    APPS.every(a => a.icon && a.category && Array.isArray(a.fields) && a.fields.length))
  check('every field has a key, label and type',
    APPS.every(a => a.fields.every(f => f.key && f.label && f.type)))
  check('showIf only ever points at a field that exists',
    APPS.every(a => a.fields.every(f => !f.showIf || a.fields.some(o => o.key === f.showIf.key))))
  check('publicDefinition never leaks the render or refresh hooks', (() => {
    const pub = publicDefinition(ig)
    return !('render' in pub) && !('refresh' in pub) && Array.isArray(pub.fields)
  })())

  const good = sanitizeAppConfig(ig, { source: 'feed', feedUrl: FEED, displayMode: 'wall', theme: 'dark' })
  check('a valid config is accepted', good.ok === true, good.error)
  check('missing values fall back to declared defaults',
    good.ok && good.config.speed === 'medium' && good.config.fontSize === 'default')

  const badMode = sanitizeAppConfig(ig, { source: 'feed', feedUrl: FEED, displayMode: 'hologram' })
  check('an option outside the declared list is rejected', badMode.ok === false)

  const badUrl = sanitizeAppConfig(ig, { source: 'feed', feedUrl: 'javascript:alert(1)' })
  check('a javascript: URL is rejected', badUrl.ok === false, badUrl.error)

  const missingUrl = sanitizeAppConfig(ig, { source: 'feed', feedUrl: '' })
  check('a required field cannot be blank', missingUrl.ok === false)

  const hiddenNotRequired = sanitizeAppConfig(ig, { source: 'token', accessToken: 'IGQabc' })
  check('a field hidden by showIf is not required', hiddenNotRequired.ok === true, hiddenNotRequired.error)
  check('a hidden field is not stored', hiddenNotRequired.ok && !('feedUrl' in hiddenNotRequired.config))

  const extra = sanitizeAppConfig(ig, { source: 'feed', feedUrl: FEED, evil: '<script>', __proto__: {} })
  check('undeclared fields are dropped', extra.ok && !('evil' in extra.config))

  const badColour = sanitizeAppConfig(ig, { source: 'feed', feedUrl: FEED, theme: 'custom', backgroundColor: 'red' })
  check('a non-hex colour is rejected', badColour.ok === false)

  const outOfRange = sanitizeAppConfig(ig, { source: 'feed', feedUrl: FEED, speed: 'custom', speedValue: 99 })
  check('a slider outside its range is rejected', outOfRange.ok === false)

  console.log('\n=== filtering ===')
  const posts = [
    { id: 'a', timestamp: new Date(Date.now() - 86400e3 * 1).toISOString() },
    { id: 'b', timestamp: new Date(Date.now() - 86400e3 * 10).toISOString() },
    { id: 'c', timestamp: new Date(Date.now() - 86400e3 * 90).toISOString() },
  ]
  check('newest first by default', applyFilter(posts, 'none', 0)[0].id === 'a')
  check('"most recent N" trims the list', applyFilter(posts, 'count', 2).length === 2)
  check('"last N days" drops older posts', applyFilter(posts, 'days', 30).length === 2)
  check('a quiet account still shows its newest post rather than nothing',
    applyFilter(posts, 'days', 0.0001).length === 1)

  console.log('\n=== instances: create, fetch, cache, mirror ===')

  const created = await call('POST', '/api/apps/instances', {
    appId: 'instagram', name: 'Front of house',
    config: { source: 'feed', feedUrl: FEED, displayMode: 'wall', theme: 'dark' },
  })
  check('an instance is created', created.status === 201, created.body)
  const id = created.body?.instance?.id
  check('it fetched on creation', !!created.body?.instance?.lastFetchedAt)
  check('the first fetch reported no error', !created.body?.instance?.lastError, created.body?.instance?.lastError)

  const unknownApp = await call('POST', '/api/apps/instances', { appId: 'nope', name: 'x', config: {} })
  check('an unknown app is refused', unknownApp.status === 400)

  const noName = await call('POST', '/api/apps/instances', { appId: 'instagram', name: '  ', config: { source: 'feed', feedUrl: FEED } })
  check('a blank name is refused', noName.status === 400)

  const data = await call('GET', `/tv/app/${id}/data`)
  check('the data endpoint serves the feed', data.status === 200 && data.body.data.posts.length === 3, data.body)
  check('the profile came through', data.body.data.profile.username === 'copperskillet')

  const first = data.body.data.posts[0]
  check('images were mirrored onto the manager', /\/app-media\//.test(first.image), first.image)
  check('mirrored paths are absolute so a TV can load them', /^http:\/\//.test(first.image))
  check('the avatar was mirrored too', !first.avatar || /\/app-media\//.test(first.avatar))
  check('a video post shows its thumbnail, not the mp4',
    data.body.data.posts.every(p => !/\.mp4/.test(p.image)))

  const mediaFiles = fs.readdirSync(path.join(dir, 'app-media'))
  check('mirrored files are on disk', mediaFiles.length >= 2, mediaFiles.length)

  const mediaRes = await fetch(first.image)
  check('a mirrored image is served back', mediaRes.status === 200 && /image\//.test(mediaRes.headers.get('content-type') || ''))

  console.log('\n=== the rendered page holds the TV compatibility line ===')

  const page = await text(`/tv/app/${id}`)
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the app page script parses', parses)
  check('no async/await', !/async function|await /.test(scripts))
  check('no arrow functions', !/=>/.test(scripts))
  check('no String.padStart', !scripts.includes('.padStart('))
  check('no Object.entries/values', !/Object\.(entries|values)\(/.test(scripts))
  check('no optional chaining or nullish coalescing', !/\?\.|\?\?/.test(scripts))
  check('no fetch (XMLHttpRequest only)', !/\bfetch\(/.test(scripts))
  check('no CSS grid', !/display\s*:\s*grid/.test(css))
  check('no flex gap', !/[^-]gap\s*:/.test(css))
  check('no CSS custom properties', !/var\(--/.test(css))
  check('the page seeds itself so a screen draws immediately', scripts.includes('onPayload('))
  check('the caption is escaped, never interpolated raw', scripts.includes('function esc('))

  console.log('\n=== hostile content cannot become markup ===')

  const nasty = await call('POST', '/api/apps/instances', {
    appId: 'instagram', name: '</script><script>alert(1)</script>',
    config: { source: 'feed', feedUrl: FEED, displayMode: 'single', theme: 'custom', backgroundColor: '#123456', textColor: '#ffffff' },
  })
  check('a hostile name is stored as data', nasty.status === 201)
  const nastyPage = await text(`/tv/app/${nasty.body.instance.id}`)
  check('the name does not close the script block', !/<\/script><script>alert/.test(nastyPage))
  check('no live tag carries an event handler', !/<[a-z][^>]*\son[a-z]+\s*=/i.test(nastyPage))

  console.log('\n=== caching: one fetch serves every screen, stale survives an outage ===')

  const hitsBefore = feedHits
  await call('GET', `/tv/app/${id}/data`)
  await call('GET', `/tv/app/${id}/data`)
  await call('GET', `/tv/app/${id}/data`)
  check('screens read the cache, not the upstream', feedHits === hitsBefore, { before: hitsBefore, after: feedHits })

  feedFails = true
  const failed = await call('POST', `/api/apps/instances/${id}/refresh`)
  check('a failed refresh is reported to the operator', failed.status === 502, failed.body)
  const afterFail = await call('GET', `/tv/app/${id}/data`)
  check('screens keep the last good posts through an outage', afterFail.body.data.posts.length === 3)
  check('the payload admits it is stale', afterFail.body.stale === true || !!afterFail.body.error)
  feedFails = false

  const recovered = await call('POST', `/api/apps/instances/${id}/refresh`)
  check('it recovers once upstream returns', recovered.status === 200)

  console.log('\n=== settings changes invalidate rather than age out ===')

  const edited = await call('PUT', `/api/apps/instances/${id}`, {
    name: 'Front of house', config: { source: 'feed', feedUrl: FEED, displayMode: 'single', theme: 'light', filterPosts: 'count', filterValue: 2 },
  })
  check('an edit saves', edited.status === 200, edited.body)
  const afterEdit = await call('GET', `/tv/app/${id}/data`)
  check('the post filter took effect immediately', afterEdit.body.data.posts.length === 2, afterEdit.body.data.posts.length)

  const badEdit = await call('PUT', `/api/apps/instances/${id}`, { config: { source: 'feed', feedUrl: FEED, theme: 'custom', backgroundColor: 'nope' } })
  check('an invalid edit is refused with a reason', badEdit.status === 400 && typeof badEdit.body.error === 'string')

  console.log('\n=== playlist plumbing ===')

  pushed.length = 0
  const published = await call('POST', `/api/apps/instances/${id}/publish`, {})
  check('publishing creates a playlist item', published.status === 201 && published.body.item.type === 'app')
  check('the item points at the instance', published.body.item.appInstanceId === id)
  check('it uses the app default duration', published.body.item.durationSeconds === 60)
  check('screens are told to refresh', pushed.some(m => m.type === 'playlist_update'))

  const again = await call('POST', `/api/apps/instances/${id}/publish`, { durationSeconds: 25 })
  check('publishing twice updates rather than duplicating', again.status === 200)
  const items = await call('GET', '/api/content')
  check('there is exactly one item for the instance', items.body.items.filter(i => i.appInstanceId === id).length === 1)
  check('the duration change took', items.body.items.find(i => i.appInstanceId === id).durationSeconds === 25)

  const active = await call('GET', '/api/content/active')
  check('the app reaches the TV playlist', active.body.items.some(i => i.type === 'app' && i.appInstanceId === id))

  const orphan = await call('POST', '/api/content', { type: 'app', appInstanceId: 'nope', name: 'x' })
  check('a content item pointing at no instance is refused', orphan.status === 400)

  pushed.length = 0
  const removed = await call('DELETE', `/api/apps/instances/${id}`)
  check('deleting an instance succeeds', removed.status === 200 && removed.body.removedFromPlaylist === 1)
  const after = await call('GET', '/api/content')
  check('its playlist item goes with it', after.body.items.filter(i => i.appInstanceId === id).length === 0)
  check('screens are told', pushed.some(m => m.type === 'playlist_update'))
  const gonePage = await fetch(`${base}/tv/app/${id}`)
  check('its page 404s afterwards', gonePage.status === 404)

  console.log('\n=== connections never leak a token ===')

  apps.setConnection({
    provider: 'instagram', accountName: 'copperskillet', accessToken: 'SECRET-TOKEN-VALUE',
    connectedAt: new Date().toISOString(), expiresAt: Date.now() + 5_000_000_000,
  })
  const conns = await call('GET', '/api/apps/connections')
  check('the connected account is listed', conns.body.connections.length === 1)
  check('the token is never serialised',
    JSON.stringify(conns.body).indexOf('SECRET-TOKEN-VALUE') === -1)
  const connFile = fs.readFileSync(path.join(dir, 'connections.json'), 'utf-8')
  check('the token lives outside db.json', connFile.includes('SECRET-TOKEN-VALUE'))
  check('db.json never holds it', !fs.readFileSync(path.join(dir, 'db.json'), 'utf-8').includes('SECRET-TOKEN-VALUE'))
  const dis = await call('DELETE', '/api/apps/connections/instagram')
  check('an account can be disconnected', dis.status === 200)
  check('and is gone afterwards', apps.getConnection('instagram') === undefined)

  console.log(`\n${pass} passed, ${fail} failed`)
  server.close(); upstream.close()
  process.exit(fail ? 1 : 0)
}))

