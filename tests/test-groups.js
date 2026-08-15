/* Integration test for device groups: runs the real compiled routers against a
   real JsonDB in a temp dir, with fake TV sockets. No Electron needed. */
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`
const { JsonDB } = require(`${DIST}/database.js`)
const { createGroupsRouter } = require(`${DIST}/routes/groups.js`)
const { createDevicesRouter } = require(`${DIST}/routes/devices.js`)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signage-test-'))
const db = new JsonDB(dir)

// fake TV connections: readyState 1 === WebSocket.OPEN
const sentTo = {}
const mkSock = id => ({ readyState: 1, send: m => { (sentTo[id] = sentTo[id] || []).push(JSON.parse(m)) } })
const tvClients = new Map()

const app = express()
app.use(express.json())
app.use('/api/groups', createGroupsRouter(db, tvClients))
app.use('/api/devices', createDevicesRouter(db, {}, tvClients))

let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    let json = null
    try { json = await res.json() } catch {}
    return { status: res.status, body: json }
  }

  console.log('\n=== group CRUD ===')
  let r = await call('POST', '/api/groups', { name: 'Lobby' })
  check('create group -> 201', r.status === 201, r)
  const lobby = r.body.id
  check('gets a colour assigned', typeof r.body.color === 'string' && r.body.color.startsWith('#'), r.body.color)

  r = await call('POST', '/api/groups', { name: '  lobby  ' })
  check('duplicate name (case/space-insensitive) -> 409', r.status === 409, r)

  r = await call('POST', '/api/groups', { name: '   ' })
  check('blank name -> 400', r.status === 400, r)

  r = await call('POST', '/api/groups', { name: 'Cafeteria' })
  const cafe = r.body.id
  r = await call('POST', '/api/groups', { name: 'Menu Boards' })
  const menu = r.body.id
  check('three groups exist', (await call('GET', '/api/groups')).body.groups.length === 3)

  console.log('\n=== membership ===')
  await call('POST', '/api/devices/register', { id: 'tv-1', name: 'Lobby TV' })
  await call('POST', '/api/devices/register', { id: 'tv-2', name: 'Cafe TV' })
  await call('POST', '/api/devices/register', { id: 'tv-3', name: 'Spare TV' })

  r = await call('PATCH', '/api/devices/tv-1', { groupIds: [lobby, menu] })
  check('device joins two groups', r.status === 200 && r.body.groupIds.length === 2, r.body)
  check('name survives a groups-only PATCH', r.body.name === 'Lobby TV', r.body.name)

  r = await call('PATCH', '/api/devices/tv-1', { name: 'Lobby Screen' })
  check('groups survive a name-only PATCH', r.body.groupIds.length === 2 && r.body.name === 'Lobby Screen', r.body)

  r = await call('PATCH', '/api/devices/tv-1', { groupIds: [lobby, lobby, 'does-not-exist'] })
  check('dupes + unknown ids filtered out', JSON.stringify(r.body.groupIds) === JSON.stringify([lobby]), r.body.groupIds)

  r = await call('PATCH', '/api/devices/tv-1', { name: '   ' })
  check('blank rename -> 400', r.status === 400, r)

  r = await call('PATCH', '/api/devices/tv-1', { groupIds: 'nope' })
  check('non-array groupIds -> 400', r.status === 400, r)

  r = await call('PATCH', '/api/devices/ghost', { name: 'x' })
  check('unknown device -> 404', r.status === 404, r)

  // the re-registration bug: a TV reconnecting must not fall out of its groups
  await call('PATCH', '/api/devices/tv-1', { groupIds: [lobby, menu] })
  await call('POST', '/api/devices/register', { id: 'tv-1', name: 'Lobby Screen', ipAddress: '192.168.1.50' })
  r = await call('GET', '/api/devices')
  const tv1 = r.body.devices.find(d => d.id === 'tv-1')
  check('re-register keeps group membership', tv1.groupIds && tv1.groupIds.length === 2, tv1.groupIds)
  check('re-register keeps the custom name', tv1.name === 'Lobby Screen', tv1.name)

  await call('PATCH', '/api/devices/tv-2', { groupIds: [cafe, menu] })

  console.log('\n=== counts ===')
  tvClients.set('tv-1', mkSock('tv-1'))          // tv-1 online, tv-2 offline
  r = await call('GET', '/api/groups')
  const byId = Object.fromEntries(r.body.groups.map(g => [g.id, g]))
  check('Lobby: 1 device, 1 online', byId[lobby].deviceCount === 1 && byId[lobby].onlineCount === 1, byId[lobby])
  check('Menu Boards: 2 devices, 1 online', byId[menu].deviceCount === 2 && byId[menu].onlineCount === 1, byId[menu])
  check('Cafeteria: 1 device, 0 online', byId[cafe].deviceCount === 1 && byId[cafe].onlineCount === 0, byId[cafe])

  console.log('\n=== push to group ===')
  // seed one content item + one project directly through the db
  const now = new Date().toISOString()
  db.insertContent({ id: 'c1', name: 'Promo', type: 'image', durationSeconds: 10, scheduleMode: 'loop', isActive: true, orderIndex: 0, createdAt: now, updatedAt: now })
  db.insertProject({ id: 'p1', name: 'Morning', durationSeconds: 10, scheduleMode: 'loop', isActive: true, orderIndex: 0, createdAt: now, updatedAt: now })
  db.insertContent({ id: 'c2', name: 'Slide', type: 'image', projectId: 'p1', durationSeconds: 10, scheduleMode: 'loop', isActive: true, orderIndex: 1, createdAt: now, updatedAt: now })

  r = await call('POST', `/api/groups/${menu}/push`, { contentId: 'c1' })
  check('push to Menu Boards -> 200', r.status === 200, r)
  check('reports 1 sent, 1 offline skipped', r.body.sent === 1 && r.body.offline === 1, r.body)
  check('the online TV actually received it', (sentTo['tv-1'] || []).some(m => m.type === 'manual_push'), sentTo['tv-1'])

  r = await call('POST', `/api/groups/${cafe}/push`, { contentId: 'c1' })
  check('all-offline group -> 503', r.status === 503, r)

  r = await call('POST', `/api/groups/${lobby}/push`, { contentId: 'missing' })
  check('unknown content -> 404', r.status === 404, r)

  r = await call('POST', `/api/groups/${menu}/push-project`, { projectId: 'p1' })
  check('push project to group -> 200 with item count', r.status === 200 && r.body.count === 1, r.body)
  check('the online TV received the project', (sentTo['tv-1'] || []).some(m => m.type === 'push_project'), true)

  r = await call('POST', '/api/groups/nope/push', { contentId: 'c1' })
  check('push to unknown group -> 404', r.status === 404, r)

  // empty group
  r = await call('POST', '/api/groups', { name: 'Empty' })
  const empty = r.body.id
  r = await call('POST', `/api/groups/${empty}/push`, { contentId: 'c1' })
  check('empty group -> 400 with a clear message', r.status === 400 && /no devices/i.test(r.body.error), r.body)

  console.log('\n=== rename / delete group ===')
  r = await call('PUT', `/api/groups/${cafe}`, { name: 'Canteen' })
  check('rename group -> 200', r.status === 200 && r.body.name === 'Canteen', r.body)
  r = await call('PUT', `/api/groups/${cafe}`, { name: 'Lobby' })
  check('rename onto an existing name -> 409', r.status === 409, r)

  r = await call('DELETE', `/api/groups/${menu}`)
  check('delete group -> 200', r.status === 200, r)
  r = await call('GET', '/api/devices')
  const after = r.body.devices
  check('membership cascade: no device still references it',
    after.every(d => !(d.groupIds || []).includes(menu)), after.map(d => d.groupIds))
  check('devices themselves survive the group delete', after.length === 3, after.length)

  r = await call('DELETE', `/api/groups/${menu}`)
  check('deleting again -> 404', r.status === 404, r)

  console.log('\n=== persistence ===')
  const db2 = new JsonDB(dir)   // reload from disk
  check('groups persisted to db.json', db2.getAllGroups().length === 3, db2.getAllGroups().map(g => g.name))
  check('membership persisted', (db2.getDeviceById('tv-1').groupIds || []).includes(lobby))

  // migration path: an old db.json with no deviceGroups key must not crash
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signage-legacy-'))
  fs.writeFileSync(path.join(legacyDir, 'db.json'), JSON.stringify({ content: [], devices: [{ id: 'x', name: 'Old TV', status: 'offline', registeredAt: now }] }))
  const legacy = new JsonDB(legacyDir)
  check('legacy db without deviceGroups migrates', Array.isArray(legacy.getAllGroups()) && legacy.getAllGroups().length === 0)
  check('legacy device still readable', legacy.getDeviceById('x').name === 'Old TV')

  console.log(`\n${pass} passed, ${fail} failed`)
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(legacyDir, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
})
