/* The QR Code board: that it shares the Designer's encoder rather than
   reimplementing it, and that every kind produces a scannable payload. */
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
const { QR_KINDS, buildQrData } = require(`${DIST}/qr-kinds.js`)
const { sanitizeDesign, renderSceneHtml } = require(`${DIST}/scenes.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-qr-'))
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

  console.log('\n=== the app and the Designer share one encoder ===')

  const qr = getApp('qrcode')
  check('the QR app is registered', !!qr)
  check('it needs no network at all', typeof qr.refresh !== 'function')

  // Every kind the Designer offers is offered here, from the same table.
  const appKinds = qr.fields.find(f => f.key === 'qrKind').options.map(o => o.value).sort()
  const sharedKinds = QR_KINDS.map(k => k.kind).sort()
  check('every Designer QR kind is offered by the app',
    appKinds.join(',') === sharedKinds.join(','), { appKinds, sharedKinds })

  // The real guarantee: a code built in the app and one built in the Designer
  // encode to exactly the same bytes.
  const wifi = { ssid: 'Guest Wi-Fi', password: 'hunter2', security: 'WPA' }
  const viaApp = await call('POST', '/api/apps/instances', {
    appId: 'qrcode', name: 'Wifi board', config: { qrKind: 'wifi', ...wifi, style: 'dark' },
  })
  check('a Wi-Fi board saves', viaApp.status === 201, viaApp.body)
  const design = sanitizeDesign({
    name: 'x', width: 1920, height: 1080, background: { color: '#000000' },
    elements: [{ id: 'q', type: 'qr', x: 0, y: 0, w: 300, h: 300, kind: 'wifi', fields: wifi, fg: '#000000', bg: '#ffffff' }],
  })
  check('the Designer encodes the same Wi-Fi payload',
    design.ok && design.design.elements[0].data === buildQrData('wifi', wifi),
    design.ok && design.design.elements[0].data)

  // Both render the symbol through the same builder, so the module counts match.
  const appPage = await text(`/tv/app/${viaApp.body.instance.id}`)
  const scenePage = renderSceneHtml({ ...design.design, id: 'd' }, '')
  const modulesOf = s => {
    const m = /viewBox=\\?"0 0 (\d+) \1\\?"/.exec(s)
    return m ? m[1] : null
  }
  check('both draw a symbol of identical size',
    modulesOf(appPage) && modulesOf(appPage) === modulesOf(scenePage),
    { app: modulesOf(appPage), designer: modulesOf(scenePage) })

  console.log('\n=== every kind produces something scannable ===')

  const samples = {
    url: { url: 'example.com' },
    text: { text: 'Ask at the bar' },
    email: { to: 'a@b.com', subject: 'Hi' },
    phone: { phone: '+15551234567' },
    sms: { phone: '+15551234567', message: 'JOIN' },
    wifi: { ssid: 'Guest', password: 'p', security: 'WPA' },
    whatsapp: { phone: '+15551234567' },
    facebook: { handle: 'nasa' },
    instagram: { handle: 'nasa' },
    x: { handle: 'nasa' },
    appstore: { url: 'https://apps.apple.com/app/id1' },
  }
  const empties = []
  for (const kind of sharedKinds) {
    const cfg = sanitizeAppConfig(qr, { qrKind: kind, ...samples[kind], style: 'dark' })
    if (!cfg.ok) { empties.push(`${kind}: ${cfg.error}`); continue }
    if (!buildQrData(kind, samples[kind])) empties.push(`${kind}: empty payload`)
  }
  check('all eleven kinds validate and encode', empties.length === 0, empties)

  check('a blank web address is refused', sanitizeAppConfig(qr, { qrKind: 'url', url: '' }).ok === false)
  check('a bad email is refused', sanitizeAppConfig(qr, { qrKind: 'email', to: 'nope' }).ok === false)
  check('a short phone number is refused', sanitizeAppConfig(qr, { qrKind: 'phone', phone: '12' }).ok === false)
  check('wifi without a password is refused',
    sanitizeAppConfig(qr, { qrKind: 'wifi', ssid: 'G', security: 'WPA' }).ok === false)
  // Fields belonging to other kinds must not be demanded.
  check('only the chosen kind\'s fields are required',
    sanitizeAppConfig(qr, { qrKind: 'text', text: 'hello' }).ok === true)
  check('and the other kinds\' fields are not stored',
    !('ssid' in (sanitizeAppConfig(qr, { qrKind: 'text', text: 'hello' }).config ?? {})))

  console.log('\n=== the board ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'qrcode', name: 'NASA',
    config: {
      qrKind: 'instagram', handle: 'nasa', style: 'instagram',
      caption: 'Follow us for latest news',
      contactWebsite: 'https://www.nasa.gov/', contactEmail: 'space@nasa.gov', contactPhone: '1-800-111-1111',
    },
  })
  check('a branded board saves', made.status === 201, made.body)
  const page = await text(`/tv/app/${made.body.instance.id}`)
  check('the caption is drawn', page.includes('Follow us for latest news'))
  // Nobody typed a headline, so the app writes one from the code itself.
  check('a headline is written from the code when none was given',
    page.includes('instagram.com/nasa'), page.match(/"headline":"[^"]*"/)?.[0])
  check('all three contact chips are present',
    page.includes('nasa.gov') && page.includes('space@nasa.gov') && page.includes('1-800-111-1111'))
  check('the Instagram gradient is applied', page.includes('linear-gradient'))
  check('the network logo is inline, never fetched', page.includes('var LOGO = "\\u003csvg'))

  const noLogo = await call('POST', '/api/apps/instances', {
    appId: 'qrcode', name: 'No logo',
    config: { qrKind: 'url', url: 'https://example.com', style: 'facebook', showLogo: false },
  })
  check('the logo can be turned off',
    (await text(`/tv/app/${noLogo.body.instance.id}`)).includes('var LOGO = ""'))

  const plain = await call('POST', '/api/apps/instances', {
    appId: 'qrcode', name: 'Plain',
    config: { qrKind: 'wifi', ssid: 'Guest Wi-Fi', password: 'hunter2', security: 'WPA', style: 'light' },
  })
  const plainPage = await text(`/tv/app/${plain.body.instance.id}`)
  check('a plain style carries no logo', plainPage.includes('var LOGO = ""'))
  check('a Wi-Fi board headlines the network name', plainPage.includes('Guest Wi-Fi'))
  // The password is encoded in the symbol but must not be printed as text.
  check('the Wi-Fi password is not written on the screen', !/hunter2/.test(plainPage.replace(/var QR_SVG[^\n]*/, '')))

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))
  check('no CSS grid or flex gap', !/display\s*:\s*grid/.test(css) && !/[^-]gap\s*:/.test(css))
  // The shared runtime is injected into every app page, so its poller exists
  // here too; what matters is that this app never calls it.
  check('it never polls for anything', !/pollData\(CFG/.test(scripts))
  check('and carries no data endpoint to poll', !/dataUrl/.test(scripts))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
