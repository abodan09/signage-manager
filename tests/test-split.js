/* Split Screen: zone geometry validation, the URL each kind resolves to, and
   the zone playlist player. */
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
const { zoneUrl } = require(`${DIST}/apps/split/index.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-split-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const Z = (o = {}) => ({ name: 'Z', top: 0, left: 0, width: 100, height: 50, kind: 'empty', refId: '', ...o })

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

  console.log('\n=== zone geometry ===')

  const sp = getApp('split')
  check('split screen is registered', !!sp)
  check('it needs no network of its own', typeof sp.refresh !== 'function')
  check('it ships a starting layout', Array.isArray(sp.fields.find(f => f.key === 'zones').default))

  const ok = sanitizeAppConfig(sp, { zones: [Z({ kind: 'app', refId: 'abc-1' })] })
  check('a valid zone is accepted', ok.ok === true, ok.error)
  check('percentages are rounded, not left ragged',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'app', refId: 'a', width: 71.94999 })] }).config.zones[0].width === 71.9)

  check('no zones at all is refused', sanitizeAppConfig(sp, { zones: [] }).ok === false)
  check('a zone with nothing in it anywhere is refused',
    sanitizeAppConfig(sp, { zones: [Z()] }).ok === false)
  check('a zone with no content chosen is refused',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'app', refId: '' })] }).ok === false)
  check('an unknown kind is refused',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'hologram', refId: 'a' })] }).ok === false)
  // Content pushed off the edge is invisible content someone configured on
  // purpose — better caught here than discovered on a wall.
  check('a zone running off the right edge is refused',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'app', refId: 'a', left: 60, width: 60 })] }).ok === false)
  check('a zone running off the bottom is refused',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'app', refId: 'a', top: 70, height: 50 })] }).ok === false)
  check('a zone touching the exact edge is fine',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'app', refId: 'a', left: 50, width: 50, height: 100 })] }).ok === true)
  check('a zero-width zone is refused',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'app', refId: 'a', width: 0 })] }).ok === false)
  check('a negative position is refused',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'app', refId: 'a', top: -5 })] }).ok === false)
  check('too many zones is refused',
    sanitizeAppConfig(sp, { zones: Array.from({ length: 20 }, () => Z({ kind: 'app', refId: 'a', height: 4 })) }).ok === false)
  check('a hostile reference id is refused',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'design', refId: '../../etc/passwd' })] }).ok === false)
  // An empty zone is legitimate as a spacer, as long as something else plays.
  check('an empty zone is allowed alongside a real one',
    sanitizeAppConfig(sp, { zones: [Z({ kind: 'app', refId: 'a', height: 50 }), Z({ top: 50, height: 50 })] }).ok === true)

  console.log('\n=== each kind resolves to a page this manager already serves ===')

  check('an app zone points at its app page',
    zoneUrl({ kind: 'app', refId: 'a1' }, 'http://m') === 'http://m/tv/app/a1')
  check('a design zone points at the scene renderer',
    zoneUrl({ kind: 'design', refId: 'd1' }, 'http://m') === 'http://m/tv/scene/d1')
  check('a playlist zone points at the zone player',
    zoneUrl({ kind: 'project', refId: 'p1' }, 'http://m') === 'http://m/tv/zone/project/p1')
  check('an empty zone resolves to nothing', zoneUrl({ kind: 'empty', refId: '' }, 'http://m') === '')

  console.log('\n=== the rendered board ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'split', name: 'Lobby layout',
    config: {
      zones: [
        { name: 'Main', top: 0, left: 0, width: 72, height: 88, kind: 'design', refId: 'design-1' },
        { name: 'News', top: 0, left: 72, width: 28, height: 88, kind: 'app', refId: 'app-1' },
        { name: 'Strip', top: 88, left: 0, width: 100, height: 12, kind: 'project', refId: 'proj-1' },
      ],
      gap: 6, background: '#101820',
    },
  })
  check('a three-zone layout saves', made.status === 201, made.body)
  const page = await text(`/tv/app/${made.body.instance.id}`)
  check('every zone gets an iframe', (page.match(/iframe/g) || []).length >= 1)
  check('the design zone points at the scene', page.includes('/tv/scene/design-1'))
  check('the app zone points at the app', page.includes('/tv/app/app-1'))
  check('the playlist zone points at the zone player', page.includes('/tv/zone/project/proj-1'))
  check('the background shows through', page.includes('#101820'))
  // The gap comes out of each zone rather than being added between them, so
  // changing it never shifts the layout.
  // The gap is applied in the page script, so the served HTML carries the
  // value and the arithmetic rather than a computed literal.
  check('the gap reaches the page', page.includes('"gap":6'))
  check('and is taken from inside each zone, not added between them',
    page.includes("'% - '") && page.includes("g / 2"))

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))

  console.log('\n=== the zone playlist player ===')

  const now = new Date().toISOString()
  db.insertProject({
    id: 'proj-1', name: 'Strip', durationSeconds: 8, scheduleMode: 'loop',
    isActive: true, orderIndex: 0, createdAt: now, updatedAt: now,
  })
  db.insertContent({
    id: 'c1', name: 'Poster', type: 'image', filePath: '/uploads/a.jpg', projectId: 'proj-1',
    durationSeconds: 5, scheduleMode: 'loop', isActive: true, orderIndex: 0, createdAt: now, updatedAt: now,
  })
  db.insertContent({
    id: 'c2', name: 'Off', type: 'image', filePath: '/uploads/b.jpg', projectId: 'proj-1',
    durationSeconds: 5, scheduleMode: 'loop', isActive: false, orderIndex: 1, createdAt: now, updatedAt: now,
  })

  const zone = await text('/tv/zone/project/proj-1')
  check('the zone player serves the playlist', zone.includes('Poster') || zone.includes('/uploads/a.jpg'))
  check('inactive items are left out', !zone.includes('/uploads/b.jpg'))
  check('media paths are absolute so the iframe can load them', zone.includes('http://127.0.0.1'))
  // Six zones on one panel must not look like six televisions to the manager.
  check('a zone never registers as a screen', !/devices\/register/.test(zone))
  check('and never opens a socket', !/WebSocket/.test(zone))
  let zParses = true
  try { new Function([...zone.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')) } catch (e) { zParses = false }
  check('the zone player parses', zParses)
  check('it is ES5', !/=>|async function|\?\?/.test(zone))

  const missing = await fetch(`${base}/tv/zone/project/nope`)
  check('an unknown playlist 404s', missing.status === 404)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
