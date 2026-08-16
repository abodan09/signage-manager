/* The Weather app: WMO code mapping, geocoding and forecast handling against a
   stand-in Open-Meteo, the three layouts, and the offline behaviour. */
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
const { describeCode, skyFor, weatherIcon, allIcons } = require(`${DIST}/apps/weather/icons.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-wx-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const tvClients = new Map()

const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, tvClients, lanUrl))
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

  console.log('\n=== WMO codes map to an icon and words people use ===')

  check('clear sky by day is a sun', describeCode(0, true).icon === 'clear-day')
  check('clear sky by night is a moon', describeCode(0, false).icon === 'clear-night')
  check('partly cloudy differs day and night',
    describeCode(2, true).icon === 'partly-day' && describeCode(2, false).icon === 'partly-night')
  check('rain looks the same at midnight as at noon',
    describeCode(63, true).icon === describeCode(63, false).icon)
  check('overcast reads as overcast', describeCode(3, true).label === 'Overcast')
  check('fog is fog', describeCode(45, true).icon === 'fog')
  check('heavy rain is distinguished from light', describeCode(65, true).icon === 'heavy-rain')
  check('snow is snow', describeCode(75, true).icon === 'snow')
  check('thunderstorm with hail has its own icon', describeCode(96, true).icon === 'thunder-hail')
  check('an unknown code degrades rather than throwing', describeCode(1234, true).icon === 'cloudy')

  // Every code Open-Meteo documents must resolve to an icon that exists.
  const ALL = [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]
  const icons = allIcons()
  const missing = ALL.filter(c => !icons[describeCode(c, true).icon] || !icons[describeCode(c, false).icon])
  check('every documented WMO code has a drawable icon', missing.length === 0, missing)
  const unnamed = ALL.filter(c => describeCode(c, true).label === 'Unknown')
  check('every documented WMO code has a label', unnamed.length === 0, unnamed)

  check('the sky is darker at night', skyFor(0, false).dark === true)
  check('a clear day is blue', skyFor(0, true).from.toLowerCase() !== skyFor(95, true).from.toLowerCase())
  check('an icon renders as svg', /^<svg /.test(weatherIcon('rain')))

  console.log('\n=== config ===')

  const wx = getApp('weather')
  check('weather is registered', !!wx)
  check('it needs no account or API key', !wx.provider)

  const good = sanitizeAppConfig(wx, { location: 'Vienna, Austria', units: 'celsius', style: 'wall', theme: 'auto' })
  check('a valid config is accepted', good.ok === true, good.error)
  check('advanced defaults fill in', good.ok && good.config.forecastDays === 7 && good.config.windUnit === 'ms')

  check('a missing location is refused', sanitizeAppConfig(wx, {}).ok === false)
  check('an unknown style is refused', sanitizeAppConfig(wx, { location: 'X', style: 'hologram' }).ok === false)
  check('too many forecast days is refused',
    sanitizeAppConfig(wx, { location: 'X', forecastDays: 30 }).ok === false)
  check('a custom colour must be hex',
    sanitizeAppConfig(wx, { location: 'X', theme: 'custom', backgroundColor: 'blue' }).ok === false)
  check('an off-server background picture is refused',
    sanitizeAppConfig(wx, { location: 'X', photo: 'https://evil.example/x.jpg' }).ok === false)
  check('an uploaded background picture is accepted',
    sanitizeAppConfig(wx, { location: 'X', photo: '/uploads/abc-1.jpg' }).ok === true)
  check('a path-traversal picture is refused',
    sanitizeAppConfig(wx, { location: 'X', photo: '/uploads/../../db.json' }).ok === false)

  console.log('\n=== fetching, against a stand-in weather service ===')

  // The real endpoints are swapped for a local stand-in so the suite does not
  // depend on the internet and can be made to fail on demand.
  let failNext = false
  let geoHits = 0, fxHits = 0
  const upstream = http.createServer((req, res) => {
    if (failNext) { res.writeHead(503); res.end('{}'); return }
    if (req.url.indexOf('/v1/search') === 0) {
      geoHits++
      if (req.url.indexOf('Nowhereville') !== -1) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ results: [
        { name: 'Vienna', country: 'Austria', admin1: 'Vienna', latitude: 48.2, longitude: 16.37 },
        { name: 'Vienna', country: 'United States', admin1: 'Virginia', latitude: 38.9, longitude: -77.3 },
      ] }))
      return
    }
    fxHits++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      timezone: 'Europe/Vienna', utc_offset_seconds: 7200,
      current: { temperature_2m: 24.4, relative_humidity_2m: 69, apparent_temperature: 25.2, is_day: 1, weather_code: 3, wind_speed_10m: 2.61 },
      current_units: { temperature_2m: '°C', wind_speed_10m: 'm/s' },
      daily: {
        time: ['2026-08-16','2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22'],
        weather_code: [3, 80, 61, 0, 95, 71, 45],
        temperature_2m_max: [24.2, 31.4, 30.1, 24.4, 23.3, 23.2, 28.4],
        temperature_2m_min: [22.1, 21.2, 23.4, 21.3, 20.2, 21.1, 21.4],
      },
    }))
  })
  await new Promise(r => upstream.listen(0, r))
  const up = `http://127.0.0.1:${upstream.address().port}`

  // Point the app's endpoints at the stand-in.
  const wxSrc = fs.readFileSync(path.join(ROOT, 'dist/main/server/apps/weather/index.js'), 'utf-8')
  check('the app talks to open-meteo by default',
    wxSrc.includes('geocoding-api.open-meteo.com') && wxSrc.includes('api.open-meteo.com'))
  const patched = wxSrc
    .replace('https://geocoding-api.open-meteo.com/v1/search', `${up}/v1/search`)
    .replace('https://api.open-meteo.com/v1/forecast', `${up}/v1/forecast`)
  fs.writeFileSync(path.join(ROOT, 'dist/main/server/apps/weather/index.js'), patched)
  delete require.cache[require.resolve(`${DIST}/apps/weather/index.js`)]
  delete require.cache[require.resolve(`${DIST}/apps/registry.js`)]
  delete require.cache[require.resolve(`${DIST}/apps/store.js`)]
  const { AppStore: FreshStore } = require(`${DIST}/apps/store.js`)
  const apps2 = new FreshStore(db, dir, assetsDir)
  const app2 = express()
  app2.use(express.json())
  const lan2 = () => `http://127.0.0.1:${server2.address().port}`
  app2.use('/api/apps', createAppsRouter(db, apps2, tvClients, lan2))
  app2.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps2, lan2))
  const server2 = app2.listen(0)
  await new Promise(r => server2.on('listening', r))
  const base2 = lan2()
  const call2 = async (m, u, b) => {
    const res = await fetch(base2 + u, {
      method: m, headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, body: json }
  }
  const text2 = async u => (await fetch(base2 + u)).text()

  const made = await call2('POST', '/api/apps/instances', {
    appId: 'weather', name: 'Weather',
    config: { location: 'Vienna, Austria', units: 'celsius', style: 'wall', theme: 'auto' },
  })
  check('an instance is created and fetches', made.status === 201 && !made.body.instance.lastError, made.body?.instance?.lastError)
  const id = made.body.instance.id
  check('the place name becomes the asset name', /Vienna/.test(made.body.instance.name), made.body.instance.name)

  const d = (await call2('GET', `/tv/app/${id}/data`)).body.data
  check('the current temperature is rounded', d.temp === 24)
  check('the condition is named', d.condition === 'Overcast')
  check('humidity and wind come through', d.humidity === 69 && d.wind === 2.6)
  check('units are carried from the service', d.tempUnit === '°C' && d.windUnit === 'm/s')
  check('seven days are returned', d.days.length === 7)
  check('each day has an icon and a range',
    d.days.every(x => x.icon && typeof x.max === 'number' && typeof x.min === 'number'))
  check('a thunderstorm day gets the thunder icon', d.days[4].icon === 'thunder')
  check('the timezone offset is passed so the clock shows local time', d.utcOffset === 7200)

  const ambiguous = await call2('POST', '/api/apps/instances', {
    appId: 'weather', name: 'US Vienna', config: { location: 'Vienna, United States', style: 'flat' },
  })
  const d2 = (await call2('GET', `/tv/app/${ambiguous.body.instance.id}/data`)).body.data
  check('a country in the query picks the right match of two', /United States/.test(d2.place), d2.place)

  const nowhere = await call2('POST', '/api/apps/instances', {
    appId: 'weather', name: 'Nope', config: { location: 'Nowhereville' },
  })
  check('an unfindable place is reported clearly',
    /Could not find/.test(nowhere.body.instance.lastError || ''), nowhere.body.instance.lastError)

  const coords = await call2('POST', '/api/apps/instances', {
    appId: 'weather', name: 'Coords', config: { location: '48.21, 16.37' },
  })
  check('coordinates skip geocoding entirely', !coords.body.instance.lastError, coords.body.instance.lastError)

  console.log('\n=== the rendered board ===')

  for (const style of ['wall', 'split', 'flat']) {
    await call2('PUT', `/api/apps/instances/${id}`, {
      config: { location: 'Vienna, Austria', units: 'celsius', style, theme: 'auto' },
    })
    const page = await text2(`/tv/app/${id}`)
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
    const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
    let ok = true
    try { new Function(scripts) } catch (e) { ok = false; console.log('   ', e.message) }
    check(`${style}: the page parses`, ok)
    check(`${style}: it is ES5`, !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))
    check(`${style}: no CSS grid or flex gap`, !/display\s*:\s*grid/.test(css) && !/[^-]gap\s*:/.test(css))
    check(`${style}: the icons are inline, not fetched`, scripts.includes('var ICONS = {'))
    check(`${style}: it draws immediately from a seed`, scripts.includes('var SEED = {'))
  }

  // The data licence requires the credit wherever the forecast is shown, and
  // no layout may be able to omit it.
  for (const style of ['wall', 'split', 'flat']) {
    await call2('PUT', `/api/apps/instances/${id}`, {
      config: { location: 'Vienna, Austria', units: 'celsius', style, theme: 'auto' },
    })
    const p = await text2(`/tv/app/${id}`)
    check(`${style}: the data provider is credited`, p.includes('Weather data by Open-Meteo.com'))
  }
  check('the credit is not a setting an operator can switch off',
    !getApp('weather').fields.some(f => /attribut|credit/i.test(f.key)))

  const page = await text2(`/tv/app/${id}`)
  check('no third-party request is made for anything visual',
    !/https?:\/\/(?!127\.0\.0\.1)/.test(page.replace(/https?:\/\/www\.w3\.org[^"']*/g, '')))

  console.log('\n=== when the weather service is down ===')

  failNext = true
  const refreshed = await call2('POST', `/api/apps/instances/${id}/refresh`)
  check('a failed refresh is reported', refreshed.status === 502)
  const stillThere = await call2('GET', `/tv/app/${id}/data`)
  check('the last good forecast stays on screen', stillThere.body.data && stillThere.body.data.temp === 24)
  failNext = false

  const geoBefore = geoHits, fxBefore = fxHits
  await call2('GET', `/tv/app/${id}/data`)
  await call2('GET', `/tv/app/${id}/data`)
  check('screens read the cache rather than the weather service',
    geoHits === geoBefore && fxHits === fxBefore)

  // Leave dist/ as the build produced it.
  fs.writeFileSync(path.join(ROOT, 'dist/main/server/apps/weather/index.js'), wxSrc)

  console.log(`\n${pass} passed, ${fail} failed`)
  server.close(); server2.close(); upstream.close()
  process.exit(fail ? 1 : 0)
})
