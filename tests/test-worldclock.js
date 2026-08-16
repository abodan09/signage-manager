/* World Clock: the count gating, per-city zone schedules, and that the board
   is the same face renderer Simple Clock uses rather than a second one. */
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

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-wc-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const wc = getApp('worldclock')
const san = o => sanitizeAppConfig(wc, o ?? {})
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

  check('world clock is registered', !!wc)
  check('it needs no network', typeof wc.refresh !== 'function')
  check('it is a utility', wc.category === 'utility')

  console.log('\n=== it works before anyone configures it ===')

  const d = san()
  check('the defaults save', d.ok === true, d.error)
  check('it opens on six clocks', d.config.clockCount === '6')
  // A board of six identical "screen's own time" clocks would be useless out of
  // the box, so the defaults are real cities across the working day.
  check('and each one is a real city', d.config.zone1 && d.config.zone6)
  check('with names for a wall, not IANA ids', d.config.label1 === 'San Francisco')
  check('the zones behind them are IANA ids', d.config.zone1 === 'America/Los_Angeles')
  check('no two default clocks share a zone',
    new Set([1, 2, 3, 4, 5, 6].map(i => d.config[`zone${i}`])).size === 6)

  console.log('\n=== the count gates the rows ===')

  const three = san({ clockCount: '3' }).config
  check('rows past the count are not stored', three.zone4 === undefined)
  check('rows within it are', three.zone3 === 'Europe/London')
  const eight = san({ clockCount: '8' }).config
  check('all eight can be used', eight.zone8 === 'Australia/Sydney')
  check('two is the floor', san({ clockCount: '1' }).ok === false)
  check('and eight the ceiling', san({ clockCount: '9' }).ok === false)
  // showIf compares with === and a select always yields a string, so a numeric
  // gate would silently hide every row for ever.
  const countField = wc.fields.find(f => f.key === 'clockCount')
  check('the count is a string, matching how showIf compares',
    countField.options.every(o => typeof o.value === 'string'))
  check('and the gates are strings too',
    wc.fields.filter(f => f.showIf && f.showIf.key === 'clockCount')
      .every(f => f.showIf.equals.every(v => typeof v === 'string')))
  check('the first two rows are never gated',
    !wc.fields.find(f => f.key === 'zone1').showIf &&
    !wc.fields.find(f => f.key === 'zone2').showIf)

  console.log('\n=== zones ===')

  check('an unknown zone is refused', san({ zone1: 'Mars/Olympus' }).ok === false)
  check('a blank zone is allowed — it means this screen\'s own time',
    san({ zone1: '' }).ok === true)
  check('a zone on a hidden row is not checked',
    san({ clockCount: '2', zone7: 'Mars/Olympus' }).ok === true)

  console.log('\n=== the rendered board ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'worldclock', name: 'Trading floor', config: { clockCount: '6' },
  })
  check('an instance saves', made.status === 201, made.body)
  const page = await text(`/tv/app/${made.body.instance.id}`)
  const scripts = scriptsOf(page)

  check('six clocks reach the page', /var CLOCKS = \[/.test(scripts))
  const clocks = JSON.parse(/var CLOCKS = (\[[\s\S]*?\]);/.exec(scripts)[1])
  check('there are six of them', clocks.length === 6, clocks.length)
  check('each is labelled', clocks.every(c => c.label))
  // The whole point of the DST machinery: the screen is handed the transitions
  // rather than a fixed offset, which would be wrong for half the year.
  check('each carries an offset schedule', clocks.every(c => Array.isArray(c.shifts)))
  check('the schedules run well ahead',
    clocks[0].shifts.length >= 2, clocks[0].shifts.length)
  check('and start with the offset in force now', clocks[0].shifts[0].from === 0)
  // Northern and southern hemispheres change on opposite dates, so two cities
  // cannot share one schedule — this is why it is per clock.
  check('cities in different zones get different schedules',
    JSON.stringify(clocks[0].shifts) !== JSON.stringify(clocks[5].shifts))

  const two = await call('POST', '/api/apps/instances', {
    appId: 'worldclock', name: 'Pair', config: { clockCount: '2' },
  })
  const twoPage = await text(`/tv/app/${two.body.instance.id}`)
  const twoClocks = JSON.parse(/var CLOCKS = (\[[\s\S]*?\]);/.exec(scriptsOf(twoPage))[1])
  check('a smaller board carries fewer clocks', twoClocks.length === 2)

  console.log('\n=== it is the same board Simple Clock draws ===')

  // Not a second implementation: the face sizes its tiles from the count, so
  // six cities lay themselves out without this app arranging anything.
  const simple = await call('POST', '/api/apps/instances', {
    appId: 'clock', name: 'One', config: { style: 'digital' },
  })
  const simplePage = await text(`/tv/app/${simple.body.instance.id}`)
  check('both pages run the same clock script',
    scripts.includes('function draw()') && simplePage.includes('function draw()'))
  check('the layout comes from the count, not from this app',
    scripts.includes('CLOCKS.length') && !scripts.includes('perRow = 3;'))

  console.log('\n=== the page a TV gets ===')

  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5',
    !/=>|async function|await |\.padStart\(|\?\?|\?\.|Object\.(entries|values)\(/.test(scripts))
  check('it never fetches from the TV', !/\bfetch\(/.test(scripts))
  check('no CSS grid', !/display\s*:\s*grid/.test(page))
  // Six tiles laid out with flex gap would collapse into a column on webOS 4.
  check('no flex gap', !/[^-]gap\s*:/.test(page))
  check('no CSS custom properties', !page.includes('var(--'))
  check('no inset shorthand', !/[^-]inset\s*:/.test(page))
  // The hands are drawn as recomputed line coordinates, never rotated, so the
  // board is safe to drop into a Split Screen zone beside a video.
  // The hyphen matters: text-transform is a typography property and fine. It is
  // the compositor `transform` that breaks a TV's hardware video plane.
  check('the analogue hands use no compositor transform', !/[^-]transform\s*:/.test(page))
  check('nor does the script set one', !/style\.transform\s*=/.test(scripts))
  check('it never reports itself finished', !/signage:ended/.test(page))

  const analog = await call('POST', '/api/apps/instances', {
    appId: 'worldclock', name: 'Dials', config: { style: 'analog', clockCount: '6' },
  })
  const analogPage = await text(`/tv/app/${analog.body.instance.id}`)
  check('the analogue board renders', analogPage.includes('"style":"analog"'))
  check('and still uses no compositor transform', !/[^-]transform\s*:/.test(analogPage))

  const nasty = await call('POST', '/api/apps/instances', {
    appId: 'worldclock', name: 'X', config: { label1: '<img src=x onerror=alert(1)>' },
  })
  const nastyPage = await text(`/tv/app/${nasty.body.instance.id}`)
  check('a hostile city name cannot inject markup',
    !/<img src=x onerror/.test(nastyPage))
  check('and cannot break out of the script block',
    !/<\/script>/.test(scriptsOf(nastyPage)))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
