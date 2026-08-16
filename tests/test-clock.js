/* Simple Clock: timezone offsets including daylight saving, and both faces. */
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
const { offsetSeconds, zoneSchedule, isKnownZone, COMMON_ZONES } = require(`${DIST}/apps/clock/zones.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-clk-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

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

  console.log('\n=== offsets are exact ===')

  // Whole minutes, always. Sub-second remainder used to leak in and turn
  // UTC-5 into -18001, which is the sort of thing nobody notices for months.
  const zones = ['UTC', 'Europe/London', 'America/New_York', 'Asia/Kolkata', 'Asia/Kathmandu', 'Australia/Sydney']
  const ragged = zones.filter(z => offsetSeconds(z, Date.now()) % 60 !== 0)
  check('every offset is a whole number of minutes', ragged.length === 0, ragged)
  check('UTC is zero', offsetSeconds('UTC', Date.now()) === 0)
  // Half- and quarter-hour zones exist and are the ones a naive implementation
  // rounds away.
  check('a half-hour zone is exact', offsetSeconds('Asia/Kolkata', Date.now()) === 19800)
  check('a quarter-hour zone is exact', offsetSeconds('Asia/Kathmandu', Date.now()) === 20700)

  const jan = Date.UTC(2026, 0, 15)
  const jul = Date.UTC(2026, 6, 15)
  check('New York shifts by an hour between winter and summer',
    Math.abs(offsetSeconds('America/New_York', jan) - offsetSeconds('America/New_York', jul)) === 3600)
  check('Sydney shifts the other way (southern hemisphere)',
    offsetSeconds('Australia/Sydney', jan) > offsetSeconds('Australia/Sydney', jul))
  check('a zone without daylight saving never shifts',
    offsetSeconds('Asia/Kolkata', jan) === offsetSeconds('Asia/Kolkata', jul))

  console.log('\n--- the schedule shipped to the screen ---')

  const ny = zoneSchedule('America/New_York', 18)
  check('a DST zone gets several shifts', ny.length >= 3, ny.length)
  check('the first applies from the beginning of time', ny[0].from === 0)
  check('later shifts are in order', ny.every((s, i) => i === 0 || s.from > ny[i - 1].from))
  check('they alternate by exactly an hour',
    ny.every((s, i) => i === 0 || Math.abs(s.offset - ny[i - 1].offset) === 3600))
  // Found to the minute, not to the day — otherwise a clock is up to 24 hours
  // adrift around a transition.
  check('transitions land on a minute boundary', ny.every(s => s.from === 0 || s.from % 60000 < 60000))
  check('a zone with no daylight saving gets a single entry', zoneSchedule('UTC', 18).length === 1)
  check('so does Kolkata', zoneSchedule('Asia/Kolkata', 18).length === 1)

  check('a known zone is accepted', isKnownZone('America/Bogota') === true)
  check('nonsense is refused', isKnownZone('Mars/Olympus_Mons') === false)
  check('an empty zone is refused', isKnownZone('') === false)
  check('the common list offers the screen\'s own time first', COMMON_ZONES[0].value === '')

  console.log('\n=== config ===')

  const clk = getApp('clock')
  check('the clock is registered', !!clk)
  // A clock that needed the network would be a poor clock.
  check('it needs no network', typeof clk.refresh !== 'function')

  check('a default config is valid', sanitizeAppConfig(clk, {}).ok === true)
  check('a bad custom zone is refused with the right shape',
    (() => { const r = sanitizeAppConfig(clk, { customZone: 'Mars/Olympus' }); return !r.ok && /Region\/City/.test(r.error) })())
  check('a good custom zone is accepted',
    sanitizeAppConfig(clk, { customZone: 'America/Bogota' }).ok === true)
  check('an unknown style is refused', sanitizeAppConfig(clk, { style: 'sundial' }).ok === false)

  console.log('\n=== the faces ===')

  const digital = await call('POST', '/api/apps/instances', {
    appId: 'clock', name: 'Clock',
    config: { style: 'digital', clockFormat: '24h', showSeconds: true, dateFormat: 'numeric', theme: 'dark' },
  })
  check('a digital clock saves', digital.status === 201, digital.body)
  const dPage = await text(`/tv/app/${digital.body.instance.id}`)
  check('it renders digits, not a dial', dPage.includes('digitalHtml') && dPage.includes('"style":"digital"'))
  check('with no timezone it uses the screen\'s own clock', dPage.includes('"shifts":null'))

  const analog = await call('POST', '/api/apps/instances', {
    appId: 'clock', name: 'Analogue',
    config: { style: 'analog', timeZone: 'America/New_York', label: 'New York', showSeconds: true },
  })
  const aPage = await text(`/tv/app/${analog.body.instance.id}`)
  check('an analogue clock saves', analog.status === 201, analog.body)
  check('the DST schedule travels with the page', /"shifts":\[\{"from":0/.test(aPage))
  check('the label is drawn', aPage.includes('New York'))
  check('the dial is drawn as svg', aPage.includes('faceHtml') && aPage.includes('viewBox="0 0 200 200"'))
  // The suggestion only replaces the app's own default name — a name the
  // operator chose is never overwritten, which is why this uses the default.
  const unnamed = await call('POST', '/api/apps/instances', {
    appId: 'clock', name: 'Simple Clock', config: { style: 'digital', timeZone: 'Asia/Tokyo' },
  })
  check('the name is suggested from the zone', /Tokyo/.test(unnamed.body.instance.name), unnamed.body.instance.name)
  check('but a name the operator chose is left alone', analog.body.instance.name === 'Analogue')

  const noSec = await call('POST', '/api/apps/instances', {
    appId: 'clock', name: 'No seconds', config: { style: 'digital', showSeconds: false, dateFormat: 'none' },
  })
  const nsPage = await text(`/tv/app/${noSec.body.instance.id}`)
  check('seconds can be hidden', nsPage.includes('"showSeconds":false'))
  // Redrawing every second when seconds are not shown is pointless work on a
  // panel that may run for months.
  check('and the redraw slows down when they are', nsPage.includes('CFG.showSeconds ? 1000 : 15000'))

  const custom = await call('POST', '/api/apps/instances', {
    appId: 'clock', name: 'Custom', config: { style: 'analog', accent: '#00ff00', theme: 'light' },
  })
  check('the second hand colour is applied',
    (await text(`/tv/app/${custom.body.instance.id}`)).includes('#00ff00'))

  const scripts = [...aPage.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (aPage.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))
  check('no CSS grid or flex gap', !/display\s*:\s*grid/.test(css) && !/[^-]gap\s*:/.test(css))
  check('it never polls', !/pollData\(CFG/.test(scripts))
  // Built for many so World Clock is the same board, not a second copy.
  check('the face is written to draw more than one clock',
    scripts.includes('CLOCKS.length') && scripts.includes('perRow'))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
