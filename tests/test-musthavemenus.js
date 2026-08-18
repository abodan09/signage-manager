/* MustHaveMenus: reading a share link, counting the pages of a design, the
   three failures that would otherwise reach a dining-room wall silently (a
   revoked link answering 200, a page number that does not exist, and their own
   scaling script not running on a TV), and the rendered page. */
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
const { parseShareUrl, readDesign } = require(`${DIST}/apps/musthavemenus/index.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-mhm-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)

/* Their real markup, trimmed to what matters: each page carries its own pixel
   size in an inline style plus a data-ratio, and the whole design — every page
   of it — is server-rendered into one document. */
const pageDiv = (n, w, h) =>
  `<div id="page-${n}" class="page" data-component="page" data-ratio="${(w / h).toFixed(10)}" ` +
  `data-size="menu-legal" style="position: relative; background: rgb(255, 255, 255); font-size: 10px; ` +
  `width: ${w}px; height: ${h}px; z-index: 1${n};" data-safe-zone="true"><div>Lechon Kawali 12.50</div></div>`

const design = pages =>
  `<!DOCTYPE html><html><head><title>Menu</title></head><body><div id="wrapper"><div id="content">` +
  pages.map(p => pageDiv(p.n, p.w, p.h)).join('') +
  `</div></div><script src="https://ohbz.com/sharelink.js"></script></body></html>`

/* What a revoked, unpublished or nonexistent design returns — with a 200 on
   it, which is the whole reason the manager has to read the body. */
const sorryPage = '<!DOCTYPE html><html><head><title>MustHaveMenus - Sorry!</title></head>'
  + '<body><h1>Sorry!</h1><p>This design is not available.</p></body></html>'

const ONE = 'https://mhme.nu/design/11111111-1111-1111-1111-111111111111'
const FIVE = 'https://mhme.nu/design/55555555-5555-5555-5555-555555555555'
const DEAD = 'https://mhme.nu/design/deaddead-dead-dead-dead-deaddeaddead'
const fivePages = [1, 2, 3, 4, 5].map(n => ({ n, w: 1920, h: 1080 }))

/* Their site is stubbed rather than served from a local port, because the app
   only ever accepts their two hosts — which is itself part of what is tested.
   Anything not addressed to them goes to the real fetch, which is how this
   file talks to its own express server. */
const realFetch = globalThis.fetch
let asked = []
globalThis.fetch = (url, init) => {
  const u = String(url && url.url ? url.url : url)
  if (u.indexOf('https://mhme.nu/') === 0 || u.indexOf('https://ohbz.com/') === 0) {
    asked.push({ url: u, origin: init && init.headers && (init.headers.Origin || init.headers.origin) })
    const body = u.indexOf('/deaddead') !== -1 ? sorryPage
      : u.indexOf('/55555555') !== -1 ? design(fivePages)
        : design([{ n: 1, w: 630, h: 1026 }])
    return Promise.resolve(new Response(body, {
      status: 200, headers: { 'content-type': 'text/html;charset=UTF-8', 'cache-control': 'no-store' },
    }))
  }
  return realFetch(url, init)
}

const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const server = app.listen(0, async () => {
  const base = lanUrl()
  const call = async (m, u, b) => {
    const res = await realFetch(base + u, {
      method: m, headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, body: json }
  }
  const text = async u => (await realFetch(base + u)).text()

  console.log('\n=== the app is registered ===')

  const mhm = getApp('musthavemenus')
  check('musthavemenus is registered', !!mhm)
  check('it needs no connected account', !mhm.provider)
  const numeric = mhm.fields.filter(f => ['number', 'slider', 'color'].includes(f.type))
  check('every numeric and colour field has a default', numeric.every(f => f.default !== undefined),
    numeric.filter(f => f.default === undefined).map(f => f.key))
  check('every showIf points at a field that exists',
    mhm.fields.every(f => !f.showIf || mhm.fields.some(o => o.key === f.showIf.key)))
  // The offline trade-off and the Publish step both have to be stated where
  // the operator will actually read them.
  const note = mhm.fields.find(f => f.type === 'note')
  check('the note says the screen needs internet', !!note && /needs internet/i.test(note.help))
  check('and that a design must be republished', !!note && /publish/i.test(note.help))

  console.log('\n=== the share link ===')

  check('an mhme.nu link is accepted', !!parseShareUrl(ONE))
  check('their canonical host is accepted too',
    !!parseShareUrl('https://ohbz.com/design/11111111-1111-1111-1111-111111111111'))
  check('tracking parameters are dropped', parseShareUrl(`${ONE}?utm_source=x&page=4`).url === ONE)
  check('somebody else\'s site is refused', !parseShareUrl('https://example.com/design/258f48b4'))
  check('http is refused', !parseShareUrl(ONE.replace('https:', 'http:')))
  check('the MustHaveMenus home page is not a design link', !parseShareUrl('https://www.musthavemenus.com/'))
  check('javascript: is refused', !parseShareUrl('javascript:alert(1)'))
  check('a bad link is refused at save time',
    sanitizeAppConfig(mhm, { url: 'https://example.com/design/1' }).ok === false)
  check('a good one is accepted', sanitizeAppConfig(mhm, { url: ONE }).ok === true)

  console.log('\n=== reading the design ===')

  const one = readDesign(design([{ n: 1, w: 630, h: 1026 }]))
  check('a single-page menu is counted', one.length === 1, one)
  check('the design keeps its own pixel size', one[0].w === 630 && one[0].h === 1026, one[0])
  const five = readDesign(design(fivePages))
  check('every page of a multi-page menu is found', five.length === 5, five.length)
  check('the pages come back in order', five.map(p => p.n).join(',') === '1,2,3,4,5')
  check('their "Sorry!" page yields no pages at all', readDesign(sorryPage).length === 0)
  // The size sits in an inline style beside font-size and z-index; neither may
  // be mistaken for the page's own width or height.
  check('font-size is not mistaken for the page size', one[0].w !== 10 && one[0].h !== 10)

  console.log('\n=== the failures that would otherwise reach a wall ===')

  const live = await call('POST', '/api/apps/instances', { appId: 'musthavemenus', name: 'Menu', config: { url: ONE } })
  check('a published menu is accepted and read', live.status === 201 && !live.body.instance.lastError,
    live.body && live.body.instance && live.body.instance.lastError)
  const liveData = (await call('GET', `/tv/app/${live.body.instance.id}/data`)).body.data
  check('its one page is known to the manager', liveData.pages.length === 1 && liveData.pages[0].w === 630,
    liveData.pages)
  check('the fetch carried no Origin header, which their edge would refuse',
    asked.length > 0 && asked.every(a => !a.origin))

  const dead = await call('POST', '/api/apps/instances', { appId: 'musthavemenus', name: 'Dead', config: { url: DEAD } })
  check('a revoked link is caught despite its 200', !!dead.body.instance.lastError)
  check('and the error tells the operator to press Publish',
    /publish/i.test(String(dead.body.instance.lastError)), dead.body.instance.lastError)

  const tooFar = await call('POST', '/api/apps/instances', {
    appId: 'musthavemenus', name: 'Page 9', config: { url: ONE, pageMode: 'one', menuPage: 9 },
  })
  check('a page the menu does not have is refused', !!tooFar.body.instance.lastError)
  check('and the message says how many there are',
    /has 1 page/.test(String(tooFar.body.instance.lastError)), tooFar.body.instance.lastError)

  const fivePagesInst = await call('POST', '/api/apps/instances', {
    appId: 'musthavemenus', name: 'Five', config: { url: FIVE, pageMode: 'one', menuPage: 4 },
  })
  check('page 4 of a five-page menu is fine', !fivePagesInst.body.instance.lastError,
    fivePagesInst.body.instance.lastError)

  console.log('\n=== the rendered page ===')

  const page = await text(`/tv/app/${live.body.instance.id}`)
  check('it frames the menu at the design\'s own size, then scales it',
    /style\.transform = 'scale\(/.test(page) && /frame\.style\.width = p\.w/.test(page))
  // Their own scaling calls window.visualViewport, which no browser before
  // Chrome 61 has — this page must never depend on it having run.
  check('it never relies on their scaling', !/visualViewport/.test(page))
  check('a page number is appended to the frame address', /'page=' \+ n/.test(page))
  check('the frame is replaced rather than re-pointed, so a reload really reloads',
    /removeChild\(frame\)/.test(page))
  check('the design\'s real size reached the page', /"w":630,"h":1026/.test(page.replace(/\s/g, '')))

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1]
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('no async/await', !/async function|await /.test(scripts))
  check('no arrow functions', !/=>/.test(scripts))
  check('no String.padStart', !scripts.includes('.padStart('))
  check('no Object.entries/values', !/Object\.(entries|values)\(/.test(scripts))
  check('no optional chaining or nullish coalescing', !/\?\.|\?\?/.test(scripts))
  check('no fetch — XMLHttpRequest only', !/\bfetch\(/.test(scripts))
  check('no CSS grid', !/display\s*:\s*grid/.test(css))
  check('no flex gap', !/[^-]gap\s*:/.test(css))
  check('no CSS custom properties', !/var\(--/.test(css))
  check('no inset shorthand', !/[^-]inset\s*:/.test(css))
  check('no position:sticky', !/position\s*:\s*sticky/.test(css))
  check('no aspect-ratio', !/aspect-ratio\s*:/.test(css))

  console.log('\n=== cycling a multi-page menu ===')

  const cycling = await call('POST', '/api/apps/instances', {
    appId: 'musthavemenus', name: 'All pages', config: { url: FIVE, pageMode: 'all', pageSeconds: 20 },
  })
  const cyclePage = await text(`/tv/app/${cycling.body.instance.id}`)
  check('it is told to cycle', /"all":true/.test(cyclePage))
  check('seconds per page is honoured', /"pageMs":20000/.test(cyclePage))
  check('all five pages reached the page',
    /"pages":\[\{"n":1/.test(cyclePage.replace(/\s/g, '')) && /"n":5/.test(cyclePage))
  check('a single-page instance is not told to cycle', /"all":false/.test(page))
  check('and starts on the page that was chosen', /"startPage":1/.test(page))
  // A five-page menu at 20s needs a 100s slot; handing back after one pass is
  // the alternative, and it must not fire on a menu that is not cycling.
  check('it does not hand back early unless asked', /"advanceAfterPass":false/.test(cyclePage))
  check('a one-page menu never hands back early', /"advanceAfterPass":false/.test(page))

  const handBack = await call('POST', '/api/apps/instances', {
    appId: 'musthavemenus', name: 'One pass',
    config: { url: FIVE, pageMode: 'all', pageSeconds: 20, advanceAfterPass: true },
  })
  const handBackPage = await text(`/tv/app/${handBack.body.instance.id}`)
  check('when asked, it hands back after the last page', /"advanceAfterPass":true/.test(handBackPage))
  check('and tells the player which instance finished',
    handBackPage.indexOf(handBack.body.instance.id) !== -1 && /signage:ended/.test(handBackPage))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
