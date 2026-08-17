/* Emergency and Flash messages: targeting, activation, and the two paths a
   screen can learn about a message on — the push, and the playlist it fetches
   when it comes back from a reboot. */
const fs = require('fs')
const os = require('os')
const path = require('path')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`
const { JsonDB } = require(`${DIST}/database.js`)
const { createOverridesRouter } = require(`${DIST}/routes/overrides.js`)
const { createContentRouter } = require(`${DIST}/routes/content.js`)
const { createPlayerRouter } = require(`${DIST}/routes/player.js`)
const ov = require(`${DIST}/overrides.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-ov-'))
const db = new JsonDB(dir)
const uploadsDir = path.join(dir, 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

// Screens: two in the Lobby group, one in Offices, one in nothing.
const now = new Date().toISOString()
const dev = (id, groups) => db.insertDevice
  ? db.insertDevice({ id, name: id, status: 'online', registeredAt: now, groupIds: groups })
  : null
db.upsertDevice
  ? [['tv-a', ['g-lobby']], ['tv-b', ['g-lobby']], ['tv-c', ['g-office']], ['tv-d', []]]
    .forEach(([id, g]) => db.upsertDevice({
      id, name: id, status: 'online', registeredAt: now, groupIds: g, pairingState: 'legacy',
    }))
  : null

// Sent messages land here instead of on a socket.
const sentTo = []
const fakeSocket = id => ({
  readyState: 1,
  send: data => sentTo.push({ id, msg: JSON.parse(data) }),
})
const tvClients = new Map()

const app = express()
app.use(express.json())
app.use('/api/overrides', createOverridesRouter(db, tvClients))
app.use('/api/content', createContentRouter(db, uploadsDir, { clients: new Set() }, tvClients))
app.use('/tv', createPlayerRouter('1.7.0'))

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

  console.log('\n=== the screens it reaches ===')

  const devices = db.getAllDevices()
  check('the fixture has four screens', devices.length === 4, devices.length)
  const O = (o = {}) => ({
    kind: 'emergency', name: 'Fire', targetKind: 'all', targetIds: [],
    contentKind: 'text', text: 'FIRE IN PROGRESS', seconds: 1800, ...o,
  })
  check('all means all', ov.targetDevices(db, O()).length === 4)
  check('a group means its members',
    ov.targetDevices(db, O({ targetKind: 'groups', targetIds: ['g-lobby'] })).sort().join() === 'tv-a,tv-b')
  check('named screens mean those screens',
    ov.targetDevices(db, O({ targetKind: 'devices', targetIds: ['tv-c'] })).join() === 'tv-c')
  check('an empty group reaches nobody rather than everybody',
    ov.targetDevices(db, O({ targetKind: 'groups', targetIds: ['g-nope'] })).length === 0)

  console.log('\n=== saving one ===')

  check('a name is required', (await call('POST', '/api/overrides', O({ name: '' }))).status === 400)
  check('text content needs words',
    (await call('POST', '/api/overrides', O({ text: '' }))).status === 400)
  check('a design must be chosen',
    (await call('POST', '/api/overrides', O({ contentKind: 'design' }))).status === 400)
  check('a picture must be one this manager holds',
    (await call('POST', '/api/overrides', O({ contentKind: 'image', imagePath: 'https://x/p.jpg' }))).status === 400)
  check('targeting groups needs a group',
    (await call('POST', '/api/overrides', O({ targetKind: 'groups', targetIds: [] }))).status === 400)
  // A message nobody cancels is the likeliest way this feature goes wrong.
  check('it cannot be set to run for ever',
    (await call('POST', '/api/overrides', O({ seconds: 999999 }))).status === 400)
  check('nor for an instant', (await call('POST', '/api/overrides', O({ seconds: 2 }))).status === 400)

  const made = await call('POST', '/api/overrides', O({ targetKind: 'groups', targetIds: ['g-lobby'] }))
  check('a good one saves', made.status === 201, made.body)
  const id = made.body.override.id
  check('it is not running yet', made.body.override.running === false)
  check('and it says how many screens it would reach', made.body.override.deviceCount === 2)

  console.log('\n=== putting it up ===')

  tvClients.set('tv-a', fakeSocket('tv-a'))
  tvClients.set('tv-b', fakeSocket('tv-b'))
  tvClients.set('tv-c', fakeSocket('tv-c'))
  sentTo.length = 0

  const up = await call('POST', `/api/overrides/${id}/activate`, {})
  check('activation succeeds', up.status === 200, up.body)
  check('it is running', up.body.override.running === true)
  check('the targeted screens were told', sentTo.length === 2, sentTo.map(s => s.id))
  check('and only them', sentTo.every(s => s.id === 'tv-a' || s.id === 'tv-b'))
  check('the message says to start', sentTo[0].msg.type === 'override_start')
  // The screen counts down on its own clock; a TV's clock is frequently wrong
  // and the manager may be asleep when the message is due to come off.
  check('it carries seconds, not just an end time',
    typeof sentTo[0].msg.override.secondsRemaining === 'number' &&
    sentTo[0].msg.override.secondsRemaining > 0)
  check('the words travel with it', sentTo[0].msg.override.text === 'FIRE IN PROGRESS')
  // Targeting is none of a screen's business.
  check('but the targeting does not', sentTo[0].msg.override.targetIds === undefined)

  console.log('\n=== a screen that missed the push ===')

  const forA = await call('GET', '/api/content/active?deviceId=tv-a')
  check('finds the message when it asks what to play', !!forA.body.override, forA.body)
  check('with a fresh countdown', forA.body.override.secondsRemaining > 0)
  const forC = await call('GET', '/api/content/active?deviceId=tv-c')
  check('a screen outside the target sees nothing', forC.body.override === null)
  const forNone = await call('GET', '/api/content/active')
  check('and neither does a request with no screen at all', forNone.body.override === null)

  console.log('\n=== two at once ===')

  const second = await call('POST', '/api/overrides', O({
    kind: 'flash', name: 'Drill', targetKind: 'all', text: 'Fire drill at 3pm', seconds: 600,
  }))
  await call('POST', `/api/overrides/${second.body.override.id}/activate`, {})
  const nowA = await call('GET', '/api/content/active?deviceId=tv-a')
  // Two people activating during one incident is a real scenario, and a screen
  // has one face.
  check('the most recently activated wins', nowA.body.override.name === 'Drill', nowA.body.override)
  const nowC = await call('GET', '/api/content/active?deviceId=tv-c')
  check('a screen only the second one covers shows the second one',
    nowC.body.override && nowC.body.override.name === 'Drill')

  console.log('\n=== standing down ===')

  sentTo.length = 0
  const down = await call('POST', `/api/overrides/${second.body.override.id}/stand-down`, {})
  check('standing down succeeds', down.status === 200)
  const afterA = await call('GET', '/api/content/active?deviceId=tv-a')
  // The first message is still running and still covers this screen, so the
  // screen must be handed that rather than being told to go back to normal.
  check('a screen still covered by another message keeps showing one',
    afterA.body.override && afterA.body.override.name === 'Fire', afterA.body.override)
  const startAgain = sentTo.find(s => s.id === 'tv-a')
  check('and is told which one, not just to stop',
    startAgain && startAgain.msg.type === 'override_start' &&
    startAgain.msg.override.name === 'Fire', startAgain && startAgain.msg)
  const endMsg = sentTo.find(s => s.id === 'tv-c')
  check('a screen no longer covered is told to stop',
    endMsg && endMsg.msg.type === 'override_end', endMsg && endMsg.msg)

  console.log('\n=== the one button that has to work ===')

  sentTo.length = 0
  const all = await call('POST', '/api/overrides/stand-down-all', {})
  check('everything comes down at once', all.status === 200 && all.body.cleared >= 1, all.body)
  check('the screens are told', sentTo.length >= 1 && sentTo.every(s => s.msg.type === 'override_end'))
  const clear = await call('GET', '/api/content/active?deviceId=tv-a')
  check('and nothing is left running', clear.body.override === null)

  console.log('\n=== housekeeping ===')

  await call('POST', `/api/overrides/${id}/activate`, {})
  check('a running message cannot be deleted by accident',
    (await call('DELETE', `/api/overrides/${id}`)).status === 409)
  await call('POST', `/api/overrides/${id}/stand-down`, {})
  check('and can once it is down', (await call('DELETE', `/api/overrides/${id}`)).status === 200)
  check('an unknown message 404s', (await call('POST', '/api/overrides/nope/activate', {})).status === 404)

  console.log('\n=== the player knows what to do with one ===')

  const player = await (await fetch(`${base}/tv/player`)).text()
  check('it listens for a message going up', player.includes("'override_start'"))
  check('and for one coming down', player.includes("'override_end'"))
  check('it has a layer above everything else', player.includes('id="override-layer"'))
  // Whatever was playing keeps playing behind an opaque layer otherwise, and a
  // video carries on decoding.
  check('putting one up tears down what was playing',
    /layer\.style\.display = 'block';[\s\S]{0,900}hideMainLayers\(\)/.test(player))
  // Words are measured, not calculated from their length: a formula from the
  // character count cut the first and last lines off a fire notice.
  check('the words are fitted by measuring them',
    /function fitOverrideText/.test(player) && /offsetHeight/.test(player))
  // And measured only once the layer is visible. A hidden box reports zero for
  // its size, the fit bails out, and the message is left at the inherited
  // 16px — which on a 1280-pixel screen is unreadable across a room.
  check('and only after the layer is on screen',
    /layer\.style\.display = 'block';[\s\S]{0,700}fitOverrideText\(\)/.test(player))
  check('a screen that changes shape refits the words',
    /addEventListener\('resize'[\s\S]{0,140}fitOverrideText/.test(player))
  check('the countdown runs on the screen\'s own clock',
    /secondsRemaining/.test(player) && /setTimeout\(endOverride/.test(player))
  check('the playlist fetch can raise one', /data\.override/.test(player))
  check('and can take one down', /else if \(overrideIsUp\(\)\) \{ endOverride\(\)/.test(player))
  check('a reconnect asks what was missed', /hasConnectedBefore/.test(player))
  // A pushed playlist or project must not draw over a live emergency.
  check('nothing else may draw over a message', /\} else if \(overrideIsUp\(\)\) \{\s*return;/.test(player))
  check('the player is still ES5',
    !/=>|async function|await |\.padStart\(|\?\?|\?\./.test(player))
  // The player already animates its ticker with a transform, which is an
  // established exception. What must not gain one is the override layer: the
  // layer underneath it may still hold a hardware-decoded video.
  const overrideCss = /#override-layer\{[\s\S]*?#logo-layer\{/.exec(player)
  check('the override layer adds no compositor transform',
    !!overrideCss && !/[^-]transform\s*:/.test(overrideCss[0]))

  console.log('\n=== it is operator-only ===')

  // /api is gated to the manager app on this machine; only TV_OPEN is exempt.
  const indexSrc = fs.readFileSync(path.join(ROOT, 'src/main/server/index.ts'), 'utf-8')
  // Up to the closing bracket of the array literal — a lazy match stops at the
  // one inside `Array<[string, RegExp]>` and reads as an empty list.
  const tvOpen = /const TV_OPEN[^=]*=\s*\[([\s\S]*?)\n\]/.exec(indexSrc)[1]
  check('activation is not on the list a TV may reach', !/overrides/.test(tvOpen), tvOpen)
  check('but the playlist a TV fetches is', tvOpen.indexOf('content') > 0, tvOpen)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
