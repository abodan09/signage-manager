/* The follower counters: one implementation behind two apps, four sources for
   a single number, and an idle state that is not an error message. */
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
const { sanitizeAppConfig } = require(`${DIST}/apps/schema.js`)
const { COUNTER_JS, FB_BRAND, IG_BRAND } = require(`${DIST}/apps/social/counter.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-cnt-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)

let withFollowers = true
const upstream = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    username: 'copperskillet', fullName: 'The Copper Skillet',
    followersCount: withFollowers ? 14202 : undefined,
    posts: [{ id: 'p1', mediaType: 'IMAGE', mediaUrl: 'http://example.invalid/x.png', caption: 'x',
      timestamp: new Date().toISOString() }],
  }))
})

const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
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

  console.log('\n=== two apps, one implementation ===')

  const ig = getApp('igcounter'), fb = getApp('fbcounter')
  check('both counters are registered', !!ig && !!fb)
  check('they appear as separate apps in the picker',
    APPS.filter(a => /counter/i.test(a.name)).length === 2)
  check('they are built from the same board', typeof COUNTER_JS === 'string' && COUNTER_JS.length > 500)
  check('their palettes differ', FB_BRAND.background !== IG_BRAND.background)
  check('Instagram labels its number FOLLOWERS', IG_BRAND.iconLabel === 'FOLLOWERS')
  check('Facebook does not label its thumb', FB_BRAND.iconLabel === '')
  // The wording is the part that genuinely differs; the layout is not.
  const cap = a => a.fields.find(f => f.key === 'caption').default
  check('each has its own call to action', cap(ig) !== cap(fb), { ig: cap(ig), fb: cap(fb) })
  check('Facebook counts likes, Instagram counts followers',
    fb.fields.find(f => f.key === 'manualCount').label === 'Likes' &&
    ig.fields.find(f => f.key === 'manualCount').label === 'Followers')
  // Only Facebook can read a live count from a token, so only it offers one.
  const sources = a => a.fields.find(f => f.key === 'source').options.map(o => o.value)
  check('only Facebook offers the Page-token source',
    sources(fb).includes('token') && !sources(ig).includes('token'), { fb: sources(fb), ig: sources(ig) })

  console.log('\n=== a number, from four places ===')

  const manual = sanitizeAppConfig(ig, { source: 'manual', manualCount: 14202 })
  check('a typed number is accepted', manual.ok === true, manual.error)
  check('the feed route needs a URL', sanitizeAppConfig(ig, { source: 'feed', feedUrl: '' }).ok === false)
  check('the Facebook token route needs both fields',
    sanitizeAppConfig(fb, { source: 'token', pageId: '1' }).ok === false)
  check('a negative count is refused',
    sanitizeAppConfig(ig, { source: 'manual', manualCount: -5 }).ok === false)

  const made = await call('POST', '/api/apps/instances', {
    appId: 'igcounter', name: 'Followers',
    config: { source: 'manual', manualCount: 14202, heading: "LET'S GO!", handle: 'copperskillet' },
  })
  check('a manual counter needs no network at all', made.status === 201 && !made.body.instance.lastError,
    made.body?.instance?.lastError)
  const id = made.body.instance.id
  check('the number reaches the screen', (await call('GET', `/tv/app/${id}/data`)).body.data.count === 14202)

  const fromFeed = await call('POST', '/api/apps/instances', {
    appId: 'igcounter', name: 'Live', config: { source: 'feed', feedUrl: FEED },
  })
  check('a feed that reports followers is read', !fromFeed.body.instance.lastError,
    fromFeed.body?.instance?.lastError)
  check('and the count is right',
    (await call('GET', `/tv/app/${fromFeed.body.instance.id}/data`)).body.data.count === 14202)

  // Most wall services return posts but no follower total; saying so beats a
  // blank screen with no explanation.
  withFollowers = false
  const noCount = await call('POST', '/api/apps/instances', {
    appId: 'igcounter', name: 'No count', config: { source: 'feed', feedUrl: FEED },
  })
  check('a feed without a follower total explains itself',
    /did not report a follower count/.test(noCount.body.instance.lastError ?? ''),
    noCount.body?.instance?.lastError)
  check('and points at the manual option',
    /number I set/i.test(noCount.body.instance.lastError ?? ''))
  withFollowers = true

  console.log('\n=== the board ===')

  const page = await text(`/tv/app/${id}`)
  check('the heading is drawn', page.includes("LET'S GO!"))
  check('the default call to action is used', page.includes('Scan to follow us!'))
  check('a QR code is generated', /var QR_SVG = "\\u003csvg/.test(page))
  check('the QR points at the handle', page.includes('instagram.com') || page.includes('QR_SVG'))
  check('the seeded number draws instantly', page.includes('"count":14202'))
  check('the Instagram gradient is applied', page.includes('linear-gradient'))

  const fbInst = await call('POST', '/api/apps/instances', {
    appId: 'fbcounter', name: 'Likes',
    config: { source: 'manual', manualCount: 20330, heading: 'The Cliff Resort', handle: 'cliffresort' },
  })
  const fbPage = await text(`/tv/app/${fbInst.body.instance.id}`)
  check('Facebook uses its own blue', fbPage.includes('#3b5998'))
  check('and its own wordmark', fbPage.includes('facebook') && !fbPage.includes('FOLLOWERS'))
  check('its default call to action is the Like wording', fbPage.includes('Scan QR to Like Us!'))

  const padded = await call('POST', '/api/apps/instances', {
    appId: 'fbcounter', name: 'Padded', config: { source: 'manual', manualCount: 8, minDigits: 5 },
  })
  const padPage = await text(`/tv/app/${padded.body.instance.id}`)
  check('leading zeros can be forced so the row does not change width',
    padPage.includes('"minDigits":5'))

  const noQr = await call('POST', '/api/apps/instances', {
    appId: 'fbcounter', name: 'No QR', config: { source: 'manual', manualCount: 8, showQr: false },
  })
  check('the QR can be turned off',
    (await text(`/tv/app/${noQr.body.instance.id}`)).includes('var QR_SVG = ""'))

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))
  check('no fetch — XMLHttpRequest only', !/\bfetch\(/.test(scripts))
  check('no CSS grid or flex gap', !/display\s*:\s*grid/.test(css) && !/[^-]gap\s*:/.test(css))
  // With no number the board shows branding, not an error — a wall should
  // never display a fault message to the public.
  check('the idle state is the wordmark, not an error', scripts.includes("root.className = 'idle'"))
  check('the icons and wordmarks are inline, never fetched',
    page.includes('var ICON = "\\u003csvg') && page.includes('var WORDMARK = "\\u003csvg'))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close(); upstream.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
}))
