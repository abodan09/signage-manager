/* Google Drive folder slideshow: reading a folder link, the shared filtering
   and ordering, the batched sync, and the slideshow page.

   The Drive API is stubbed at the fetch boundary — there is no network here. */
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
const { parseFolderId, folderLinkProblem } = require(`${DIST}/apps/gdrive/index.js`)
const core = require(`${DIST}/apps/folder/core.js`)
const { syncFolder } = require(`${DIST}/apps/folder/sync.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-gd-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const gd = getApp('gdrive')
const FOLDER = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp'
const C = (o = {}) => ({ folderUrl: FOLDER, ...o })
const san = o => sanitizeAppConfig(gd, C(o))
const scriptsOf = html =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')

const raw = (o = {}) => ({
  id: 'f1', name: 'a.jpg', mimeType: 'image/jpeg', size: 1000,
  modifiedAt: '2026-01-01T00:00:00Z', version: 'v1', downloadUrl: 'https://x/f1', ...o,
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
  const text = async u => (await fetch(base + u)).text()

  console.log('\n=== registration ===')

  check('google drive is registered', !!gd)
  check('it has its own provider key, not a shared google one', gd.provider === 'googledrive')
  // sharepoint already owns 'microsoft'; connections are one record per
  // provider, so a collision would sign one app out by using the other.
  check('and does not collide with sharepoint', gd.provider !== 'microsoft')
  check('it fetches on a schedule', typeof gd.refresh === 'function')

  console.log('\n=== reading a folder link ===')

  check('a folder link is understood', parseFolderId(FOLDER) === '1AbCdEfGhIjKlMnOp')
  check('a link with a query still works',
    parseFolderId(`${FOLDER}?usp=sharing`) === '1AbCdEfGhIjKlMnOp')
  check('a bare id is accepted', parseFolderId('1AbCdEfGhIjKlMnOp') === '1AbCdEfGhIjKlMnOp')
  check('rubbish returns null', parseFolderId('hello world') === null)
  check('a link to one file is refused',
    /one file/i.test(folderLinkProblem('https://drive.google.com/file/d/1Abc/view') || ''))
  check('a google doc is refused',
    /document/i.test(folderLinkProblem('https://docs.google.com/document/d/1Abc/edit') || ''))
  check('a good link has no complaint', folderLinkProblem(FOLDER) === null)
  check('the link is required', san({ folderUrl: '' }).ok === false)
  check('a bad link is refused at save time',
    san({ folderUrl: 'https://drive.google.com/file/d/1Abc/view' }).ok === false)

  console.log('\n=== what a screen can actually play ===')

  const f = core.filterItems([
    raw({ id: '1', name: 'a.jpg', mimeType: 'image/jpeg' }),
    raw({ id: '2', name: 'b.png', mimeType: 'image/png' }),
    raw({ id: '3', name: 'c.mp4', mimeType: 'video/mp4' }),
    raw({ id: '4', name: 'd.mov', mimeType: 'video/quicktime' }),
    raw({ id: '5', name: 'notes.pdf', mimeType: 'application/pdf' }),
    raw({ id: '6', name: 'Deck', mimeType: 'application/vnd.google-apps.presentation' }),
    raw({ id: '7', name: 'huge.jpg', mimeType: 'image/jpeg', size: 999_000_000 }),
  ], { includeVideo: true, maxBytes: 10_000_000 })

  check('jpegs and pngs are kept', f.keep.filter(i => i.mimeType.startsWith('image/')).length === 2)
  check('mp4 is kept', f.keep.some(i => i.mimeType === 'video/mp4'))
  // A panel that cannot decode a file holds the rotation for its whole dwell
  // showing nothing, which is worse than the file not being there.
  check('a mov is skipped with advice', f.skipped.some(s => /MP4/.test(s.reason)))
  check('a pdf is skipped', f.skipped.some(s => s.name === 'notes.pdf'))
  check('a slide deck is skipped as a category, not a fault',
    f.skipped.some(s => s.name === 'Deck' && /pictures and videos/i.test(s.reason)))
  check('an oversized file is skipped with its size',
    f.skipped.some(s => s.name === 'huge.jpg' && /MB/.test(s.reason)))

  const noVideo = core.filterItems([raw({ id: '3', name: 'c.mp4', mimeType: 'video/mp4' })],
    { includeVideo: false, maxBytes: 1e9 })
  check('videos can be switched off', noVideo.keep.length === 0)

  console.log('\n=== ordering ===')

  // An operator numbers files 1..10 to set the order; a plain string sort puts
  // 10 straight after 1, which reads as the app ignoring them.
  check('numbers in names sort as numbers', core.compareNatural('img2.jpg', 'img10.jpg') < 0)
  check('and not as text', core.compareNatural('img10.jpg', 'img2.jpg') > 0)
  const names = ['10 - j.jpg', '2 - b.jpg', '1 - a.jpg'].map((n, i) => raw({ id: String(i), name: n }))
  check('name order is natural',
    core.orderItems(names, 'name', 1).map(i => i.name)[0] === '1 - a.jpg')
  check('reverse name order works',
    core.orderItems(names, 'nameDesc', 1).map(i => i.name)[0] === '10 - j.jpg')
  const dated = [
    raw({ id: 'a', modifiedAt: '2026-01-01T00:00:00Z' }),
    raw({ id: 'b', modifiedAt: '2026-06-01T00:00:00Z' }),
  ]
  check('newest first', core.orderItems(dated, 'newest', 1)[0].id === 'b')
  check('oldest first', core.orderItems(dated, 'oldest', 1)[0].id === 'a')
  // Every screen showing one folder must show the same picture at the same
  // moment, so the shuffle is computed here, once, not on each panel.
  const many = Array.from({ length: 12 }, (_, i) => raw({ id: 'x' + i, name: 'x' + i }))
  const s1 = core.orderItems(many, 'random', 7).map(i => i.id).join()
  const s2 = core.orderItems(many, 'random', 7).map(i => i.id).join()
  const s3 = core.orderItems(many, 'random', 8).map(i => i.id).join()
  check('the shuffle is the same for one sync', s1 === s2)
  check('and different on the next', s1 !== s3)
  check('the shuffle keeps every file', s1.split(',').length === 12)

  console.log('\n=== the sync ===')

  const inst = { id: 'inst-1', appId: 'gdrive', name: 'Lobby', config: C({ imageSeconds: 12 }) }
  const asked = []
  const ctx = {
    instance: inst, data: null, fontCss: '', baseUrl: base,
    mirror: async () => null,
    writeMedia: () => '/app-media/x.png',
    mirrorFile: async (url, opts) => { asked.push({ url, name: opts.name }); return `/app-media/${opts.name}` },
  }

  const list = [
    raw({ id: 'i1', name: '1.jpg', mimeType: 'image/jpeg' }),
    raw({ id: 'i2', name: '2.jpg', mimeType: 'image/jpeg' }),
    raw({ id: 'i3', name: '3.mp4', mimeType: 'video/mp4' }),
  ]
  const out = await syncFolder(ctx, { list: async () => list })
  check('every playable file is copied', asked.length === 3)
  check('the payload carries them all', out.data.items.length === 3)
  check('images use the chosen dwell', out.data.items[0].seconds === 12)
  // A video runs to its own length; a fixed dwell would cut it off or leave a
  // frozen last frame.
  check('a video takes its own length', out.data.items[2].seconds === 0)
  check('the video is marked as one', out.data.items[2].kind === 'video')
  check('the sync interval is honoured', out.ttlSeconds === 5 * 60)
  check('it is not still filling', out.data.filling === false)

  // The stored name must not be derivable from the file id: /app-media is
  // readable by anything on the LAN.
  const stored = asked[0].name
  check('the stored name hides the drive file id', stored.indexOf('i1') < 0, stored)
  check('and is content-addressed', /^[0-9a-f]{32}\.jpg$/.test(stored), stored)
  const otherCtx = Object.assign({}, ctx, { instance: { ...inst, id: 'inst-2' } })
  const asked2 = []
  otherCtx.mirrorFile = async (url, opts) => { asked2.push(opts.name); return `/app-media/${opts.name}` }
  await syncFolder(otherCtx, { list: async () => list })
  check('two instances of the same folder do not share file names',
    asked2[0] !== stored)

  // A file replaced in Drive keeps its id but changes its checksum; reusing the
  // name would leave screens showing the old picture out of the media cache.
  const asked3 = []
  const ctx3 = Object.assign({}, ctx, {
    mirrorFile: async (url, opts) => { asked3.push(opts.name); return `/app-media/${opts.name}` },
  })
  await syncFolder(ctx3, { list: async () => [raw({ id: 'i1', name: '1.jpg', version: 'v2' })] })
  check('a replaced file gets a new name', asked3[0] !== stored)

  console.log('\n=== a folder bigger than one pass ===')

  const big = Array.from({ length: 40 }, (_, i) =>
    raw({ id: 'b' + i, name: String(i).padStart(3, '0') + '.jpg' }))
  const askedBig = []
  const ctxBig = Object.assign({}, ctx, {
    data: null,
    mirrorFile: async (url, opts) => { askedBig.push(opts.name); return `/app-media/${opts.name}` },
  })
  const first = await syncFolder(ctxBig, { list: async () => big })
  // refresh() writes its cache once at the end, so copying forty files before
  // returning would leave the wall empty for the whole download.
  check('the first pass copies a bounded batch', askedBig.length <= 12, askedBig.length)
  check('and shows what it has', first.data.items.length === askedBig.length)
  check('it says it is still filling', first.data.filling === true)
  check('and asks to be called back soon', first.ttlSeconds <= 60, first.ttlSeconds)

  const ctxBig2 = Object.assign({}, ctxBig, { data: first.data })
  const second = await syncFolder(ctxBig2, { list: async () => big })
  check('the next pass keeps what it already had', second.data.items.length > first.data.items.length)
  check('and does not re-copy it', askedBig.length < 40)

  console.log('\n=== caps ===')

  const capped = await syncFolder(
    Object.assign({}, ctx, { instance: { ...inst, config: C({ maxItems: 2 }) }, data: null }),
    { list: async () => list })
  check('the item cap is applied', capped.data.items.length === 2)
  check('and the rest is reported as skipped',
    capped.data.skipped.some(s => /more files/.test(s.name)))

  console.log('\n=== the slideshow page ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'gdrive', name: 'Lobby folder', config: C(),
  })
  check('an instance saves', made.status === 201, made.body)
  const page = await text(`/tv/app/${made.body.instance.id}`)

  check('the page renders before the first sync', page.includes('CFG'))
  check('it polls relatively', /"dataUrl":"\/tv\//.test(page))
  check('it says what an empty folder means', page.includes('Add pictures or videos'))

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
  // These pages carry a <video>, so the player's rule reaches them: a
  // transformed layer over a hardware-decoded picture can blank it.
  check('the crossfade uses opacity, never a transform', !/transform/.test(page))
  check('and it is a real transition', /transition:opacity/.test(page))
  check('a picture is decoded out of sight first', /new Image\(\)/.test(scripts))
  check('a video that never ends still advances', /onerror/.test(scripts) && /120000/.test(scripts))
  check('it never reports itself finished', !/signage:ended/.test(page))

  const nasty = await call('POST', '/api/apps/instances', {
    appId: 'gdrive', name: '<img src=x onerror=alert(1)>', config: C(),
  })
  const nastyPage = await text(`/tv/app/${nasty.body.instance.id}`)
  check('a hostile instance name is escaped', !/<img src=x onerror/.test(nastyPage))

  console.log('\n=== the api key ===')

  const bad = await call('POST', '/api/apps/connections/googledrive/key', { key: 'nope' })
  check('a rubbish key is refused', bad.status === 400)
  const other = await call('POST', '/api/apps/connections/dropbox/key', { key: 'x'.repeat(40) })
  check('a provider that takes no key is refused', other.status === 404)
  // OneDrive takes a key too, but a different shape of one — a client id.
  const wrongShape = await call('POST', '/api/apps/connections/onedrive/key', { key: 'x'.repeat(40) })
  check('and each provider checks the shape of its own', wrongShape.status === 400)
  const good = await call('POST', '/api/apps/connections/googledrive/key', {
    key: 'AIzaSyD-ExampleKeyForTestingOnly1234567',
  })
  check('a plausible key is stored', good.status === 200, good.body)

  const conns = await call('GET', '/api/apps/connections')
  const gk = conns.body.connections.find(c => c.provider === 'googledrive')
  check('the connection appears', !!gk)
  // The key is a credential; the UI has no reason to ever hold it.
  check('and the key itself is never handed back',
    !JSON.stringify(conns.body).includes('AIzaSyD-ExampleKeyForTestingOnly1234567'))
  check('only a hint of it is shown', /…/.test(gk.accountName || ''))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
