/* Boots the REAL server (startServer) with Electron stubbed, then attacks it:
   the loopback/Host/Origin admin gate, and the WebSocket register path. */
const Module = require('module')
const os = require('os')
const fs = require('fs')
const path = require('path')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const STUB = path.join(__dirname, 'electron-stub.js')

// Redirect `require('electron')` to the stub, and resolve the server's bare
// npm requires out of the project's node_modules.
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return STUB
  try { return origResolve.call(this, request, parent, ...rest) }
  catch (e) {
    if (/^[a-z@]/.test(request)) return origResolve.call(this, path.join(ROOT, 'node_modules', request), parent, ...rest)
    throw e
  }
}

const WebSocket = require(`${ROOT}/node_modules/ws`)
const { startServer } = require(`${ROOT}/dist/main/server/index.js`)
const { getLocalIP } = require(`${ROOT}/dist/main/server/discovery.js`)
const { JsonDB } = require(`${ROOT}/dist/main/server/database.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-srv-'))

;(async () => {
  const port = await startServer(userData, 3599, '1.7.0')
  const LOOP = `http://127.0.0.1:${port}`
  const lanIp = getLocalIP()
  const db = new JsonDB(userData)

  const get = async (url, headers) => {
    const res = await fetch(url, { headers: headers || {} })
    let body = null; try { body = await res.json() } catch {}
    return { status: res.status, body }
  }
  const post = async (url, payload, headers) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
      body: JSON.stringify(payload || {}),
    })
    let body = null; try { body = await res.json() } catch {}
    return { status: res.status, body }
  }

  console.log('\n=== admin surface is loopback-only ===')
  let r = await get(`${LOOP}/api/devices`)
  check('loopback, no Origin (packaged Electron) -> 200', r.status === 200, r)

  r = await get(`${LOOP}/api/devices`, { origin: 'http://localhost:5173' })
  check('loopback + Vite dev origin -> 200', r.status === 200, r)

  r = await get(`${LOOP}/api/devices`, { origin: 'http://evil.example' })
  check('loopback + foreign Origin -> 403', r.status === 403, r)

  // fetch() refuses to set Host, so drive a raw request for the rebinding shape.
  const rawGet = (hostHeader) => new Promise(resolve => {
    const req = require('http').request(
      { host: '127.0.0.1', port, path: '/api/devices', method: 'GET', headers: { Host: hostHeader } },
      res => { res.resume(); resolve(res.statusCode) })
    req.on('error', () => resolve(0))
    req.end()
  })
  check('DNS-rebinding shape (Host: attacker.test) -> 403', (await rawGet('attacker.test')) === 403)
  check('Host: localhost still allowed', (await rawGet(`localhost:${port}`)) === 200)
  check(`Host: <lan-ip> refused`, (await rawGet(`${lanIp}:${port}`)) === 403)

  r = await post(`${LOOP}/api/pair/approve`, { code: 'BCDFGHJK' }, { origin: 'http://evil.example' })
  check('approve from a foreign origin -> 403', r.status === 403, r)

  console.log('\n=== TV endpoints stay open to the LAN ===')
  for (const [name, res] of [
    ['register',       await post(`${LOOP}/api/devices/register`, { id: 'tv-open-1' })],
    ['content/active', await get(`${LOOP}/api/content/active`)],
    ['pair/start',     await post(`${LOOP}/api/pair/start`, { platform: 'browser' })],
    ['health',         await get(`${LOOP}/api/health`)],
    ['discovery',      await get(`${LOOP}/api/discovery`)],
  ]) check(`${name} reachable`, res.status === 200, res)

  const player = await fetch(`${LOOP}/tv/player`)
  check('/tv/player served', player.status === 200)
  check('player sends Referrer-Policy: no-referrer', player.headers.get('referrer-policy') === 'no-referrer')
  const playerHtml = await player.text()
  check('player has a pairing screen', playerHtml.includes('id="pair-screen"'))
  check('player calls no .padStart( (ES2017, throws on webOS 4)', !playerHtml.includes('.padStart('))
  check('player uses the pad2 helper instead', playerHtml.includes('function pad2('))
  check('version was injected', !playerHtml.includes('__APP_VERSION__') && playerHtml.includes("'1.7.0'"))

  console.log('\n=== same checks from the real LAN address ===')
  if (lanIp && lanIp !== '127.0.0.1') {
    const LAN = `http://${lanIp}:${port}`
    r = await get(`${LAN}/api/devices`)
    check(`admin API refused from LAN ip (${lanIp}) -> 403`, r.status === 403, r)
    r = await post(`${LAN}/api/pair/approve`, { code: 'BCDFGHJK' })
    check('a rogue LAN device cannot approve its own pairing -> 403', r.status === 403, r)
    r = await post(`${LAN}/api/devices/register`, { id: 'tv-lan-1' })
    check('but a TV can still register from the LAN -> 200', r.status === 200, r)
    r = await post(`${LAN}/api/pair/start`, { platform: 'android' })
    check('and can still start pairing -> 200', r.status === 200, r)
  } else {
    console.log('  SKIP  no non-loopback address available')
  }

  console.log('\n=== WebSocket ===')
  const openWS = (headers, onMsg) => new Promise(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: headers || {} })
    const state = { ws, closeCode: null, msgs: [] }
    ws.on('message', d => { const m = JSON.parse(d.toString()); state.msgs.push(m); onMsg && onMsg(m, ws) })
    ws.on('close', c => { state.closeCode = c; resolve(state) })
    ws.on('open', () => resolve(state))
    ws.on('error', () => resolve(state))
  })

  const evil = await openWS({ origin: 'http://evil.example' })
  await new Promise(r2 => setTimeout(r2, 300))
  check('cross-site WebSocket handshake rejected (4403)', evil.closeCode === 4403, evil.closeCode)

  const native = await openWS()   // no Origin, like a native shell
  native.ws.send(JSON.stringify({ type: 'register', deviceId: 'ws-tv-1', name: 'WS TV' }))
  await new Promise(r2 => setTimeout(r2, 300))
  check('native-shell socket (no Origin) accepted', native.closeCode === null)
  check('device recorded online', new JsonDB(userData).getDeviceById('ws-tv-1')?.status === 'online')

  const silent = await openWS()
  await new Promise(r2 => setTimeout(r2, 5600))
  check('a socket that never registers is dropped (4408)', silent.closeCode === 4408, silent.closeCode)

  console.log('\n=== required mode over WebSocket ===')
  await fetch(`${LOOP}/api/settings`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pairingMode: 'required' }),
  })
  const rogue = await openWS()
  rogue.ws.send(JSON.stringify({ type: 'register', deviceId: 'rogue-unknown' }))
  await new Promise(r2 => setTimeout(r2, 400))
  check('unknown device refused in required mode (4401)', rogue.closeCode === 4401, rogue.closeCode)
  check('and told why', rogue.msgs.some(m => m.type === 'unauthorized' && m.reason === 'pairing_required'), rogue.msgs)
  check('it never entered the connected set', !new JsonDB(userData).getDeviceById('rogue-unknown'))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('harness error:', e); process.exit(1) })
