/* Device pairing integration tests â€” real compiled routers, real JsonDB,
   fake TV sockets. Mirrors the spec's test plan. */
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`
const { JsonDB } = require(`${DIST}/database.js`)
const { PairingStore, sha256 } = require(`${DIST}/pairing.js`)
const { createPairRouter } = require(`${DIST}/routes/pair.js`)
const { createDevicesRouter } = require(`${DIST}/routes/devices.js`)
const { createSettingsRouter } = require(`${DIST}/routes/settings.js`)
const { createGroupsRouter } = require(`${DIST}/routes/groups.js`)

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-pair-'))
const db = new JsonDB(dir)
const pairing = new PairingStore()

const sent = {}
const mkSock = id => ({ readyState: 1, sent: [], closed: null,
  send(m) { (sent[id] = sent[id] || []).push(JSON.parse(m)) },
  close(code) { this.closed = code; this.readyState = 3 } })
const tvClients = new Map()

const app = express()
app.use(express.json())
app.use('/api/pair', createPairRouter(db, pairing, tvClients))
app.use('/api/devices', createDevicesRouter(db, {}, tvClients))
app.use('/api/settings', createSettingsRouter(db, tvClients))
app.use('/api/groups', createGroupsRouter(db, tvClients))

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, url, body, headers) => {
    const res = await fetch(base + url, {
      method,
      headers: Object.assign(body ? { 'content-type': 'application/json' } : {}, headers || {}),
      body: body ? JSON.stringify(body) : undefined,
    })
    let json = null
    try { json = await res.json() } catch {}
    return { status: res.status, body: json, headers: res.headers }
  }
  const dbFile = () => JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf-8'))

  console.log('\n=== migration ===')
  check('fresh install has settings', !!db.getSettings().serverId)
  check('default mode is open (never blacks out a fleet)', db.getSettings().pairingMode === 'open')

  // legacy db.json without settings/pairingState
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-legacy-'))
  fs.writeFileSync(path.join(legacyDir, 'db.json'), JSON.stringify({
    content: [], projects: [],
    devices: [{ id: 'old-1', name: 'Lobby TV', status: 'offline', registeredAt: '2026-01-01T00:00:00Z', groupIds: ['g1'] }],
  }))
  const legacy = new JsonDB(legacyDir)
  check('pre-pairing device grandfathered as legacy', legacy.getDeviceById('old-1').pairingState === 'legacy')
  check('its groups survive the migration', JSON.stringify(legacy.getDeviceById('old-1').groupIds) === '["g1"]')
  check('settings backfilled with a serverId', !!legacy.getSettings().serverId)

  console.log('\n=== open mode keeps v1.6.0 behaviour ===')
  let r = await call('POST', '/api/devices/register', { id: 'legacy-1', name: 'Old TV' })
  check('token-less register still works', r.status === 200, r)
  check('new record marked unpaired', r.body.pairingState === 'unpaired', r.body)
  check('response never contains tokenHash', !('tokenHash' in r.body), Object.keys(r.body))

  console.log('\n=== full pairing handshake ===')
  r = await call('POST', '/api/pair/start', { platform: 'webos', playerVersion: '1.7.0' })
  check('start -> 200', r.status === 200, r)
  const userCode = r.body.userCode, deviceCode = r.body.deviceCode
  check('userCode is 4-4 base-20, no vowels', /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(userCode), userCode)
  check('deviceCode is high entropy (43 chars)', typeof deviceCode === 'string' && deviceCode.length === 43, deviceCode && deviceCode.length)
  check('expiresIn 900 / interval 5', r.body.expiresIn === 900 && r.body.interval === 5, r.body)

  r = await call('POST', '/api/pair/poll', { deviceCode })
  check('poll before approval -> authorization_pending', r.body.status === 'authorization_pending', r.body)

  r = await call('GET', '/api/pair/pending')
  check('pending list shows the request', r.body.requests.length === 1 && r.body.requests[0].userCode === userCode, r.body)

  // approve with messy input: lowercase, spaces instead of the dash
  const messy = userCode.replace('-', ' ').toLowerCase()
  r = await call('POST', '/api/pair/approve', { code: messy, name: 'Lobby Screen' })
  check('approve forgives case/spacing', r.status === 200, r)
  const pairedId = r.body.deviceId
  check('server minted a NEW id (not client-supplied)', pairedId && pairedId !== 'legacy-1', pairedId)

  r = await call('POST', '/api/pair/poll', { deviceCode })
  check('poll now returns paired + token', r.body.status === 'paired' && !!r.body.token, r.body)
  const token = r.body.token
  check('device is named as requested', r.body.name === 'Lobby Screen', r.body)

  console.log('\n=== start is rate limited per screen ===')
  r = await call('POST', '/api/pair/start', {})
  check('a second start from the same ip within 10s -> 429', r.status === 429, r)
  check('429 carries Retry-After', !!r.headers.get('retry-after'))

  console.log('\n=== the deviceCode is the anti-race binding ===')
  // Drive the store directly so distinct "screens" get distinct source IPs.
  const aRaw = pairing.start({ ip: '10.0.0.8' })
  const bRaw = pairing.start({ ip: '10.0.0.9' })
  check('two screens can pair concurrently', aRaw.ok && bRaw.ok)
  check('their codes differ', aRaw.userCode !== bRaw.userCode, [aRaw.userCode, bRaw.userCode])
  r = await call('POST', '/api/pair/approve', { code: aRaw.userCode })
  check('approving A succeeds', r.status === 200, r)
  r = await call('POST', '/api/pair/poll', { deviceCode: bRaw.deviceCode })
  check('B is unaffected by A being approved', r.body.status === 'authorization_pending', r.body)
  r = await call('POST', '/api/pair/poll', { deviceCode: aRaw.userCode.replace('-', '') })
  check('seeing the userCode does NOT let you redeem it', r.status === 404, r)

  console.log('\n=== token survives reconnect (the upsertDevice trap) ===')
  await call('PATCH', `/api/devices/${pairedId}`, { groupIds: [] })
  const hashBefore = dbFile().devices.find(d => d.id === pairedId).tokenHash
  for (let i = 0; i < 5; i++) {
    r = await call('POST', '/api/devices/register', { id: 'whatever' }, { authorization: `Bearer ${token}` })
    if (r.status !== 200) break
  }
  const after = dbFile().devices.find(d => d.id === pairedId)
  check('5 reconnects keep the SAME tokenHash', after.tokenHash === hashBefore, { hashBefore, after: after.tokenHash })
  check('still paired after reconnects', after.pairingState === 'paired', after.pairingState)
  check('name not clobbered by reconnect', after.name === 'Lobby Screen', after.name)
  check('raw token never written to db.json', !fs.readFileSync(path.join(dir, 'db.json'), 'utf-8').includes(token))

  console.log('\n=== token never leaks through any response ===')
  const surfaces = [
    await call('GET', '/api/devices'),
    await call('POST', '/api/devices/register', { id: 'x' }, { authorization: `Bearer ${token}` }),
    await call('PATCH', `/api/devices/${pairedId}`, { name: 'Lobby Screen' }),
  ]
  const leaked = surfaces.some(s => JSON.stringify(s.body).includes('tokenHash') || JSON.stringify(s.body).includes(token))
  check('no surface exposes tokenHash or the raw token', !leaked)

  console.log('\n=== approve rate limiting ===')
  pairing._reset()
  let attempts = []
  for (let i = 0; i < 5; i++) {
    r = await call('POST', '/api/pair/approve', { code: 'BCDFGHJK' })
    attempts.push(r.status)
  }
  check('5 wrong-but-well-formed codes all 404', attempts.every(s => s === 404), attempts)
  r = await call('POST', '/api/pair/approve', { code: 'BCDFGHJK' })
  check('6th attempt locks out with 429', r.status === 429, r)
  check('lockout sets Retry-After', !!r.headers.get('retry-after'))
  const live = pairing.start({ ip: '10.0.0.5' })
  r = await call('POST', '/api/pair/approve', { code: live.userCode })
  check('a VALID code is also refused while locked', r.status === 429, r)

  pairing._reset()
  const malformed = ['123', 'ABCDEFGH', 'BCDF', '', 'BCDF-GHJ']
  const mstat = []
  for (const c of malformed) { mstat.push((await call('POST', '/api/pair/approve', { code: c })).status) }
  check('malformed codes all 400', mstat.every(s => s === 400), mstat)
  const live2 = pairing.start({ ip: '10.0.0.6' })
  r = await call('POST', '/api/pair/approve', { code: live2.userCode })
  check('typos never consume the attempt budget', r.status === 200, r)

  console.log('\n=== slow_down ratchets (RFC 8628 3.5) ===')
  pairing._reset()
  const s1 = pairing.start({ ip: '10.0.0.7' })
  check('first poll is pending', pairing.poll(s1.deviceCode).status === 'authorization_pending')
  let p2 = pairing.poll(s1.deviceCode)
  check('immediate second poll -> slow_down interval 10', p2.status === 'slow_down' && p2.interval === 10, p2)
  let p3 = pairing.poll(s1.deviceCode)
  check('third fast poll ratchets to 15 (never resets)', p3.status === 'slow_down' && p3.interval === 15, p3)

  console.log('\n=== required mode ===')
  pairing._reset()
  await call('PATCH', '/api/settings', { pairingMode: 'required' })
  check('mode persisted', (await call('GET', '/api/settings')).body.pairingMode === 'required')

  r = await call('POST', '/api/devices/register', { id: 'brand-new-unknown' })
  check('unknown device with no token -> 401 pairing_required', r.status === 401 && r.body.reason === 'pairing_required', r)
  r = await call('POST', '/api/devices/register', { id: 'legacy-1' })
  check('a device that self-registered AFTER the upgrade is refused', r.status === 401, r)

  // A genuinely pre-pairing screen (present in db.json before the upgrade) must
  // keep working forever without a token â€” this is the no-blackout guarantee.
  db.upsertDevice({ id: 'grandfathered-1', name: 'Old Lobby TV', status: 'offline',
    registeredAt: '2026-01-01T00:00:00Z', groupIds: [], pairingState: 'legacy' })
  r = await call('POST', '/api/devices/register', { id: 'grandfathered-1' })
  check('pre-pairing device still allowed in (grandfathered)', r.status === 200, r)
  check('and it stays legacy, not silently upgraded', dbFile().devices.find(d => d.id === 'grandfathered-1').pairingState === 'legacy')
  r = await call('POST', '/api/devices/register', { id: 'x' }, { authorization: 'Bearer garbage' })
  check('garbage token -> 401 unknown_token', r.status === 401 && r.body.reason === 'unknown_token', r)
  r = await call('POST', '/api/devices/register', { id: 'x' }, { authorization: `Bearer ${token}` })
  check('valid token -> 200', r.status === 200, r)

  console.log('\n=== revoke / delete are two-sided ===')
  const sock = mkSock(pairedId)
  tvClients.set(pairedId, sock)
  r = await call('POST', `/api/devices/${pairedId}/revoke`)
  check('revoke -> 200', r.status === 200, r)
  check('screen was told it is unpaired', (sent[pairedId] || []).some(m => m.type === 'unpaired'))
  check('socket closed with 4401', sock.closed === 4401, sock.closed)
  const rec = dbFile().devices.find(d => d.id === pairedId)
  check('record survives with name + state unpaired', rec && rec.name === 'Lobby Screen' && rec.pairingState === 'unpaired', rec)
  check('tokenHash removed', !rec.tokenHash, rec.tokenHash)
  r = await call('POST', '/api/devices/register', { id: 'x' }, { authorization: `Bearer ${token}` })
  check('revoked token no longer works', r.status === 401, r)

  console.log('\n=== replace an existing screen keeps identity ===')
  pairing._reset()
  await call('PATCH', '/api/settings', { pairingMode: 'open' })
  const g = (await call('POST', '/api/groups', { name: 'Lobby Group' })).body
  const victim = (await call('POST', '/api/devices/register', { id: 'victim-1', name: 'Front Desk' })).body
  await call('PATCH', `/api/devices/victim-1`, { groupIds: [g.id] })
  const vsock = mkSock('victim-1'); tvClients.set('victim-1', vsock)
  const rep = pairing.start({ ip: '10.0.0.8' })
  r = await call('POST', '/api/pair/approve', { code: rep.userCode, replaceDeviceId: 'victim-1' })
  check('replace -> 200 bound to the SAME id', r.status === 200 && r.body.deviceId === 'victim-1', r.body)
  const vrec = dbFile().devices.find(d => d.id === 'victim-1')
  check('name preserved', vrec.name === 'Front Desk', vrec.name)
  check('groups preserved', JSON.stringify(vrec.groupIds) === JSON.stringify([g.id]), vrec.groupIds)
  check('no duplicate record created', dbFile().devices.filter(d => d.name === 'Front Desk').length === 1)
  check('old socket evicted', vsock.closed === 4401, vsock.closed)

  console.log('\n=== untrust legacy ===')
  r = await call('POST', '/api/settings/untrust-legacy')
  check('untrust-legacy reports how many changed', r.status === 200 && typeof r.body.changed === 'number', r.body)
  check('no device is legacy afterwards', dbFile().devices.every(d => d.pairingState !== 'legacy'))

  console.log(`\n${pass} passed, ${fail} failed`)
  server.close()
  pairing.stopSweeper()
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(legacyDir, { recursive: true, force: true })
  process.exit(fail ? 1 : 0)
})
