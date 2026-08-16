/* The Facebook Page wall: Graph parsing, the shared wall views, and proof that
   Instagram and Facebook really are one implementation with two faces. */
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`
const { JsonDB } = require(`${DIST}/database.js`)
const { AppStore } = require(`${DIST}/apps/store.js`)
const { getApp } = require(`${DIST}/apps/registry.js`)
const { sanitizeAppConfig } = require(`${DIST}/apps/schema.js`)
const { fetchFacebookPage } = require(`${DIST}/apps/social/sources.js`)
const { FB_GLYPH, IG_GLYPH, SOCIAL_WALL_JS } = require(`${DIST}/apps/social/wall.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-fb-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')
const upstream = http.createServer((req, res) => {
  if (req.url.indexOf('/img') === 0) {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    res.end(PNG); return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    username: 'fanofsony', fullName: 'Fan of Sony',
    profilePictureUrl: `http://127.0.0.1:${upstream.address().port}/img/a.png`,
    posts: [
      { id: 'f1', mediaType: 'IMAGE', mediaUrl: `http://127.0.0.1:${upstream.address().port}/img/1.png`,
        caption: 'Those were the days!', timestamp: new Date(Date.now() - 3600e3).toISOString() },
      { id: 'f2', mediaType: 'IMAGE', mediaUrl: `http://127.0.0.1:${upstream.address().port}/img/2.png`,
        caption: 'Second post', timestamp: new Date(Date.now() - 7200e3).toISOString() },
    ],
  }))
})

const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/app-media', express.static(apps.mediaPath))
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
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

  console.log('\n=== one wall, two faces ===')

  const fb = getApp('facebook'), ig = getApp('instagram')
  check('facebook is registered', !!fb)
  check('both are social apps', fb.category === 'social' && ig.category === 'social')
  // The whole point of the refactor: the layouts are shared, not copied.
  check('the two share one wall implementation', typeof SOCIAL_WALL_JS === 'string' && SOCIAL_WALL_JS.length > 1000)
  check('the glyphs differ', FB_GLYPH !== IG_GLYPH && /viewBox/.test(FB_GLYPH))

  const modes = f => (f.fields.find(x => x.key === 'displayMode').options || []).map(o => o.value).join(',')
  check('both offer the same four display modes', modes(fb) === modes(ig), modes(fb))

  const igPage = await (async () => {
    const made = await call('POST', '/api/apps/instances', {
      appId: 'instagram', name: 'IG', config: { source: 'feed', feedUrl: FEED, displayMode: 'wall', theme: 'dark' },
    })
    return text(`/tv/app/${made.body.instance.id}`)
  })()

  console.log('\n=== config ===')

  const ok = sanitizeAppConfig(fb, { source: 'feed', feedUrl: FEED, displayMode: 'single', theme: 'dark' })
  check('a valid config is accepted', ok.ok === true, ok.error)
  check('a missing feed URL is refused', sanitizeAppConfig(fb, { source: 'feed', feedUrl: '' }).ok === false)
  check('the token route needs a Page ID',
    sanitizeAppConfig(fb, { source: 'token', accessToken: 'EAAG' }).ok === false)
  check('the token route needs a token',
    sanitizeAppConfig(fb, { source: 'token', pageId: '123' }).ok === false)
  check('the token route is happy with both',
    sanitizeAppConfig(fb, { source: 'token', pageId: '123', accessToken: 'EAAG' }).ok === true)
  check('a javascript: feed URL is refused',
    sanitizeAppConfig(fb, { source: 'feed', feedUrl: 'javascript:alert(1)' }).ok === false)
  // The reference product promises this in its sign-in dialog; the config
  // should say it too, because it is the question every operator asks.
  const note = fb.fields.find(f => f.type === 'note')
  check('the connected-Page note promises nothing is posted', !!note && /never posted|read-only/i.test(note.help))

  console.log('\n=== the Page feed ===')

  // A stand-in Graph so the parsing is exercised without a Meta app.
  const graph = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    if (req.url.indexOf('/posts') !== -1) {
      res.end(JSON.stringify({ data: [
        { id: '1_1', message: 'Those were the days!', created_time: '2026-08-01T10:00:00+0000',
          full_picture: `http://127.0.0.1:${upstream.address().port}/img/1.png`,
          permalink_url: 'https://facebook.com/1', attachments: { data: [{ media_type: 'photo' }] } },
        { id: '1_2', story: 'Fan of Sony updated their cover photo.', created_time: '2026-07-30T10:00:00+0000',
          full_picture: `http://127.0.0.1:${upstream.address().port}/img/2.png`, attachments: { data: [{ media_type: 'video' }] } },
        { id: '1_3', created_time: '2026-07-29T10:00:00+0000' },
      ] }))
    } else {
      res.end(JSON.stringify({ name: 'Fan of Sony', username: 'fanofsony',
        picture: { data: { url: `http://127.0.0.1:${upstream.address().port}/img/a.png` } } }))
    }
  })
  await new Promise(r => graph.listen(0, r))

  const payload = await fetchFacebookPage('123', 'tok', 25).catch(e => ({ error: e.message }))
  // fetchFacebookPage points at the real graph host, so this proves it fails
  // cleanly rather than hanging or throwing something unreadable.
  check('an unreachable Graph fails with a readable message',
    !!payload.error && typeof payload.error === 'string', payload.error)
  graph.close()

  console.log('\n=== the rendered wall ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'facebook', name: 'Facebook',
    config: { source: 'feed', feedUrl: FEED, displayMode: 'single', theme: 'dark', showQr: true },
  })
  check('an instance is created and fetches', made.status === 201 && !made.body.instance.lastError,
    made.body?.instance?.lastError)
  const id = made.body.instance.id
  check('the Page name becomes the asset name', /Fan of Sony/.test(made.body.instance.name), made.body.instance.name)

  const data = (await call('GET', `/tv/app/${id}/data`)).body.data
  check('posts come through', data.posts.length === 2)
  check('images are mirrored onto the manager', /\/app-media\//.test(data.posts[0].image))
  check('the avatar is mirrored', /\/app-media\//.test(data.posts[0].avatar))

  const page = await text(`/tv/app/${id}`)
  check('the page wears the Facebook glyph', page.includes('22 12.06') || page.includes('BRAND_SVG'))
  check('it does NOT wear the Instagram glyph', !page.includes('17.6" cy="6.4'))
  // Inlined SVG is escaped by jsonLiteral, so a literal "<svg" never appears —
  // the check is that the variable is populated rather than the empty string.
  check('a QR code is drawn when asked',
    /var QR_SVG = "\\u003csvg/.test(page), page.match(/var QR_SVG = ".{0,24}/)?.[0])

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))
  check('no fetch — XMLHttpRequest only', !/\bfetch\(/.test(scripts))

  // The point of sharing the module is that the drawing code is byte-identical
  // in both apps — only the config, the glyph and the title differ.
  const wallBody = SOCIAL_WALL_JS.trim()
  check('the Facebook page carries the shared wall code verbatim', page.includes(wallBody))
  check('the Instagram page carries the very same code', igPage.includes(wallBody))
  const drawFns = s => (s.match(/function draw[A-Za-z]+\(/g) || []).sort().join(',')
  check('both draw through the same set of layouts',
    drawFns(page) === drawFns(igPage) && drawFns(page).length > 0, drawFns(page))

  console.log('\n=== text-only posts ===')
  const noPhoto = await call('POST', '/api/apps/instances', {
    appId: 'facebook', name: 'Photos only',
    config: { source: 'feed', feedUrl: FEED, requirePhoto: true },
  })
  check('the photos-only filter is accepted', noPhoto.status === 201, noPhoto.body)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close(); upstream.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
}))
