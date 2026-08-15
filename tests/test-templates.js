/* Templates: resolution chain, presets, theme validation, per-device payloads,
   and the no-visual-change-on-upgrade guarantee. */
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`
const { JsonDB } = require(`${DIST}/database.js`)
const { PRESETS, defaultTheme, resolveTemplate, sanitizeTheme, DEFAULT_TEMPLATE_ID } = require(`${DIST}/templates.js`)
const { createTemplatesRouter } = require(`${DIST}/routes/templates.js`)
const { createDevicesRouter } = require(`${DIST}/routes/devices.js`)
const { createGroupsRouter } = require(`${DIST}/routes/groups.js`)
const { createContentRouter } = require(`${DIST}/routes/content.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-tpl-'))
const db = new JsonDB(dir)
const sent = {}
const mkSock = id => ({ readyState: 1, send: m => { (sent[id] = sent[id] || []).push(JSON.parse(m)) }, close(){} })
const tvClients = new Map()

const app = express()
app.use(express.json())
app.use('/api/templates', createTemplatesRouter(db, tvClients))
app.use('/api/devices', createDevicesRouter(db, {}, tvClients))
app.use('/api/groups', createGroupsRouter(db, tvClients))
app.use('/api/content', createContentRouter(db, dir, {}, tvClients))

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (m, u, b) => {
    const res = await fetch(base + u, {
      method: m, headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, body: json }
  }

  console.log('\n=== presets are code, not data ===')
  let r = await call('GET', '/api/templates')
  check('6 built-in layouts offered', r.body.presets.length === 6, r.body.presets && r.body.presets.length)
  check('all 6 exposed as assignable templates', r.body.templates.filter(t => t.builtin).length === 6)
  const dbFile = () => {
    const p = path.join(dir, 'db.json')
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : { templates: [] }
  }
  check('nothing seeded into db.json', dbFile().templates.length === 0)
  check('default is builtin:fullscreen', r.body.defaultTemplateId === DEFAULT_TEMPLATE_ID, r.body.defaultTemplateId)

  console.log('\n=== fullscreen reproduces v1.6.0 geometry exactly ===')
  const fs0 = resolveTemplate(db.getTemplateById('builtin:fullscreen'))
  const z = fs0.zones
  check('media is full-bleed on all four edges',
    z.main.left === 0 && z.main.right === 0 && z.main.top === 0 && z.main.bottom === 0, z.main)
  check('overlay keeps the 80px padding', z.overlay.pad === '80px', z.overlay.pad)
  check('ticker is a 72px bottom bar', z.ticker.height === '72px' && z.ticker.bottom === 0, z.ticker)
  check('progress bar is 4px at the very bottom', z.progress.height === '4px' && z.progress.bottom === 0, z.progress)
  check('logo and clock are off by default', z.logo.visible === false && z.clock.visible === false)
  check('no zone uses the inset shorthand', !JSON.stringify(z).includes('"inset"'))
  check('every preset zone z-index stays under player chrome',
    Object.keys(z).filter(k => k !== 'progress').every(k => z[k].z <= 99), z)

  console.log('\n=== every preset resolves cleanly ===')
  for (const id of Object.keys(PRESETS)) {
    const t = resolveTemplate({ id: 'x', name: 'x', preset: id, theme: defaultTheme(), createdAt: '', updatedAt: '' })
    const slots = ['main', 'overlay', 'ticker', 'logo', 'clock', 'progress']
    const ok = slots.every(s => t.zones[s] && typeof t.zones[s].z === 'number' && typeof t.zones[s].visible === 'boolean')
    check(`${id}: all six slots defined`, ok, t.zones)
    check(`${id}: font family resolved server-side`, typeof t.fontFamily === 'string' && t.fontFamily.length > 0)
  }
  check('portrait-poster is marked portrait', PRESETS['portrait-poster'].orientation === 'portrait')
  check('fullscreen-ticker lifts media above the bar', PRESETS['fullscreen-ticker'].zones.main.bottom === '72px')

  console.log('\n=== theme validation ===')
  check('rejects a non-hex colour', sanitizeTheme({ bgColor: 'red' }).ok === false)
  check('rejects a CSS injection attempt', sanitizeTheme({ bgColor: '#000;}body{display:none' }).ok === false)
  check('rejects out-of-range opacity', sanitizeTheme({ bandOpacity: 400 }).ok === false)
  check('rejects an arbitrary font scale', sanitizeTheme({ fontScale: 99 }).ok === false)
  check('rejects a logo path outside /uploads', sanitizeTheme({ logoPath: '../../etc/passwd' }).ok === false)
  check('rejects an absolute logo URL', sanitizeTheme({ logoPath: 'http://evil.example/x.png' }).ok === false)
  check('accepts a real uploaded logo', sanitizeTheme({ logoPath: '/uploads/abc-123.png' }).ok === true)
  check('accepts valid values', sanitizeTheme({ bgColor: '#101820', bandOpacity: 50, fontScale: 1.25 }).ok === true)

  console.log('\n=== template CRUD ===')
  r = await call('POST', '/api/templates', { name: 'Cafe Board', preset: 'fullscreen-ticker', theme: { brandColor: '#ff8800' } })
  check('create -> 201', r.status === 201, r)
  const tpl = r.body
  check('unknown preset rejected', (await call('POST', '/api/templates', { name: 'x', preset: 'nope' })).status === 400)
  check('blank name rejected', (await call('POST', '/api/templates', { name: '  ', preset: 'fullscreen' })).status === 400)
  check('built-ins cannot be edited', (await call('PUT', '/api/templates/builtin:fullscreen', { name: 'hax' })).status === 400)
  check('built-ins cannot be deleted', (await call('DELETE', '/api/templates/builtin:fullscreen')).status === 400)

  r = await call('PUT', `/api/templates/${tpl.id}`, { theme: { bandOpacity: 40 } })
  check('update merges theme without losing other fields',
    r.body.theme.bandOpacity === 40 && r.body.theme.brandColor === '#ff8800', r.body.theme)

  console.log('\n=== resolution chain: device > group > default ===')
  await call('POST', '/api/devices/register', { id: 'tv-a', name: 'TV A' })
  const grp = (await call('POST', '/api/groups', { name: 'Cafeteria' })).body
  await call('PATCH', '/api/devices/tv-a', { groupIds: [grp.id] })

  check('falls back to the install default', db.resolveTemplateForDevice('tv-a').id === DEFAULT_TEMPLATE_ID)

  await call('PUT', '/api/templates/assign', { scope: 'group', id: grp.id, templateId: tpl.id })
  check('inherits its group template', db.resolveTemplateForDevice('tv-a').id === tpl.id)

  const solo = (await call('POST', '/api/templates', { name: 'Solo', preset: 'welcome-lobby' })).body
  await call('PUT', '/api/templates/assign', { scope: 'device', id: 'tv-a', templateId: solo.id })
  check('device assignment beats the group', db.resolveTemplateForDevice('tv-a').id === solo.id)

  await call('PUT', '/api/templates/assign', { scope: 'device', id: 'tv-a', templateId: null })
  check('clearing the device falls back to the group again', db.resolveTemplateForDevice('tv-a').id === tpl.id)

  await call('PUT', '/api/templates/assign', { scope: 'default', templateId: 'builtin:branded-frame' })
  check('unknown device gets the install default', db.resolveTemplateForDevice('nobody').id === 'builtin:branded-frame')
  check('assigning a missing template -> 404',
    (await call('PUT', '/api/templates/assign', { scope: 'device', id: 'tv-a', templateId: 'ghost' })).status === 404)

  console.log('\n=== payloads carry the right template per screen ===')
  r = await call('GET', '/api/content/active?deviceId=tv-a')
  check('content/active returns a resolved template', r.body.template && r.body.template.zones, r.body.template)
  check('and it is the screen-specific one', r.body.template.id === tpl.id, r.body.template.id)

  // two screens, different templates, one group push
  await call('POST', '/api/devices/register', { id: 'tv-b', name: 'TV B' })
  await call('PATCH', '/api/devices/tv-b', { groupIds: [grp.id] })
  await call('PUT', '/api/templates/assign', { scope: 'device', id: 'tv-b', templateId: solo.id })
  tvClients.set('tv-a', mkSock('tv-a')); tvClients.set('tv-b', mkSock('tv-b'))
  const now = new Date().toISOString()
  db.insertContent({ id: 'c1', name: 'Promo', type: 'image', durationSeconds: 10, scheduleMode: 'loop', isActive: true, orderIndex: 0, createdAt: now, updatedAt: now })
  await call('POST', `/api/groups/${grp.id}/push`, { contentId: 'c1' })
  const aMsg = (sent['tv-a'] || []).find(m => m.type === 'manual_push')
  const bMsg = (sent['tv-b'] || []).find(m => m.type === 'manual_push')
  check('screen A got its group template', aMsg && aMsg.template.id === tpl.id, aMsg && aMsg.template.id)
  check('screen B got its own device template', bMsg && bMsg.template.id === solo.id, bMsg && bMsg.template.id)
  check('a group push is serialised per screen, not shared', aMsg.template.id !== bMsg.template.id)

  console.log('\n=== assignments survive template deletion ===')
  await call('DELETE', `/api/templates/${solo.id}`)
  check('device detached from the deleted template', !db.getDeviceById('tv-b').templateId)
  check('it falls back rather than breaking', !!db.resolveTemplateForDevice('tv-b').zones)

  console.log('\n=== upgrade changes nothing already on a wall ===')
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-tpl-legacy-'))
  fs.writeFileSync(path.join(legacyDir, 'db.json'), JSON.stringify({
    content: [{ id: 't1', name: 'Old Text', type: 'text', textContent: 'hi', textFgColor: '#ff0000',
      textBgColor: '#00ff00', textFontSize: 60, overlayOpacity: 40, durationSeconds: 10,
      scheduleMode: 'loop', isActive: true, orderIndex: 0, createdAt: now, updatedAt: now }],
    devices: [], projects: [], deviceGroups: [],
  }))
  const legacyDb = new JsonDB(legacyDir)
  const oldText = legacyDb.getContentById('t1')
  check('existing text keeps supplying its own styling', oldText.styleSource === 'custom', oldText.styleSource)
  check('its colours are untouched', oldText.textFgColor === '#ff0000' && oldText.overlayOpacity === 40)
  check('legacy install defaults to the fullscreen template',
    legacyDb.resolveTemplateForDevice(undefined).preset === 'fullscreen')

  console.log(`\n${pass} passed, ${fail} failed`)
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(legacyDir, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
})
