/* The self-updater. Every case here is a way the old one failed on a real
   network: a proxy that answers and then goes quiet, a rate-limited GitHub
   reported as "up to date", a 404 page written into the .exe and executed, a
   redirect with no Location that resolved to localhost.

   The https module is stubbed rather than a real server being started, because
   the failures worth testing are precisely the ones a well-behaved server will
   not produce on demand. */
const path = require('path')
const { EventEmitter } = require('events')
const { Readable } = require('stream')

const ROOT = path.join(__dirname, '..').replace(/\\\\/g, '/')
const DIST = `${ROOT}/dist/main`

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

// ── stub electron and https before the module under test is loaded ──────────
// Unlike the app suites, this one loads a module that imports electron at the
// top level, so electron has to be resolvable before the require.
const electronPath = require.resolve(`${ROOT}/tests/electron-stub.js`)
const Module = require('module')
const realResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'electron') return electronPath
  return realResolve.call(this, request, ...rest)
}
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true, children: [], paths: [],
  exports: {
    app: { getVersion: () => '1.9.0', getPath: () => require('os').tmpdir(), quit() {} },
    ipcMain: { handle() {}, on() {} },
    BrowserWindow: class {},
    shell: { openExternal() {} },
  },
}

/* One scripted reply per request. Each entry is { status, headers, body } or
   { status, headers, stall: true } — the last of which sends headers, sends
   part of the body, and then simply stops, which is the shape that used to
   hang the app for ever. */
let script = []
let asked = []

function fakeRequest(url, opts, cb) {
  asked.push(String(url))
  const req = new EventEmitter()
  req.destroy = err => { req.destroyed = true; if (err) req.emit('error', err) }
  req.setTimeout = (ms, fn) => { req._timeout = setTimeout(fn, ms); if (req._timeout.unref) req._timeout.unref() }

  const reply = script.shift() || { status: 404, headers: {}, body: 'no script entry' }
  setImmediate(() => {
    const res = new Readable({ read() {} })
    res.statusCode = reply.status
    res.headers = reply.headers || {}
    cb(res)
    if (reply.stall) {
      // Headers, a little body, then silence — the socket-idle timer is what
      // has to rescue this, and its abort lands on the response, not the
      // request. Without a listener on the response it used to vanish.
      res.push(Buffer.from('{"partial":'))
      req.setTimeoutFired = true
      // Simulate the timeout firing: destroy the request WITH an error, which
      // the production code now does, and route it to the response the way
      // Node does once a response exists.
      setTimeout(() => res.destroy(new Error('socket hang up')), 60)
      return
    }
    if (reply.body !== undefined) res.push(Buffer.from(reply.body))
    res.push(null)
  })
  return req
}

const httpsPath = require.resolve('https')
require.cache[httpsPath] = {
  id: httpsPath, filename: httpsPath, loaded: true, children: [], paths: [],
  exports: { __esModule: true, default: { get: fakeRequest }, get: fakeRequest },
}

const upd = require(`${DIST}/updater.js`)

async function main() {
  console.log('\n=== version comparison ===')

  check('a newer version wins', upd.versionGt('1.9.0', '1.8.3'))
  check('an older one does not', !upd.versionGt('1.8.3', '1.9.0'))
  check('equal is not greater', !upd.versionGt('1.9.0', '1.9.0'))
  check('a longer version still compares', upd.versionGt('1.9.1', '1.9'))
  // Number('0-rc') is NaN and every NaN comparison is false, so a prerelease
  // build used to be told it was up to date for ever.
  check('a prerelease does not break the comparison', upd.versionGt('1.9.0', '1.9.0-rc.1') === false)
  check('and the release after it is still offered', upd.versionGt('1.10.0', '1.9.0-rc.1'))
  check('junk does not produce NaN', upd.versionGt('2.0.0', 'not-a-version'))

  console.log('\n=== release notes ===')

  check('bullets are taken as-is',
    upd.parseReleaseNotes('## Stuff\n- One thing\n- Two **bold** things') === 'One thing\nTwo bold things')
  // With no bullets the fallback used to hand back raw Markdown, so operators
  // read "## What's Changed" and "**Full Changelog**: https://…" on screen.
  const noBullets = upd.parseReleaseNotes("## What's Changed\nWe fixed the thing.\n**Full Changelog**: https://github.com/a/b/compare/v1...v2")
  check('the fallback drops headings', noBullets.indexOf('#') === -1, noBullets)
  check('the fallback drops the generated compare link', !/Full Changelog/i.test(noBullets), noBullets)
  check('and keeps the actual sentence', noBullets.indexOf('We fixed the thing.') !== -1, noBullets)
  check('the fallback strips markdown too',
    upd.parseReleaseNotes('Just **one** line').indexOf('**') === -1)

  console.log('\n=== the release manifest ===')

  const yml = upd.parseLatestYml([
    'version: 1.9.0',
    'files:',
    '  - url: Signage-Manager-Setup-1.9.0.exe',
    '    sha512: OYe6mJ/pKKOeL==',
    '    size: 78094354',
    'path: Signage-Manager-Setup-1.9.0.exe',
    'sha512: OYe6mJ/pKKOeL==',
    "releaseDate: '2026-08-18T21:53:38.322Z'",
  ].join('\n'))
  check('the installer name is read', yml.path === 'Signage-Manager-Setup-1.9.0.exe', yml)
  check('the checksum is read', yml.sha512 === 'OYe6mJ/pKKOeL==', yml)
  check('the size is read', yml.size === 78094354, yml)
  check('a manifest that is not there yields nothing', !upd.parseLatestYml('').path)

  console.log('\n=== an answer that never finishes ===')

  // The bug: a proxy answers 200, sends part of a body, then goes quiet. The
  // response's error was swallowed because nothing listened for it, so the
  // promise never settled and "Checking for updates…" span for ever.
  script = [{ status: 200, headers: {}, stall: true }]
  const stalled = await Promise.race([
    upd.openStream('https://api.github.com/x', 500).then(
      res => new Promise((resolve, reject) => {
        res.on('data', () => {})
        res.on('end', () => resolve('ended'))
        res.on('error', e => reject(e))
      }),
      e => { throw e },
    ).then(v => ({ settled: v }), e => ({ settled: 'rejected', message: e.message })),
    new Promise(r => setTimeout(() => r({ settled: 'HUNG' }), 3000)),
  ])
  check('a stalled reply settles instead of hanging for ever', stalled.settled !== 'HUNG', stalled)
  check('and it settles as a failure, not a success',
    stalled.settled === 'rejected', stalled)

  console.log('\n=== an answer that is not a success ===')

  script = [{ status: 403, headers: {}, body: JSON.stringify({ message: 'API rate limit exceeded for 1.2.3.4' }) }]
  const rate = await upd.openStream('https://api.github.com/x', 500).then(() => 'resolved', e => e.message)
  check('a rate limit is rejected, never treated as an empty release list',
    rate !== 'resolved', rate)
  check('and it says what happened in words', /rate-limiting/i.test(String(rate)), rate)

  script = [{ status: 404, headers: {}, body: JSON.stringify({ message: 'Not Found' }) }]
  const missing = await upd.openStream('https://api.github.com/x', 500).then(() => 'resolved', e => e.message)
  check('a 404 is rejected rather than written to disk', missing !== 'resolved', missing)

  check('the rate-limit wording is reserved for a real rate limit',
    /rate-limiting/i.test(upd.describeStatus(403, '{"message":"API rate limit exceeded"}')) &&
    !/rate-limiting/i.test(upd.describeStatus(403, '{"message":"Forbidden"}')))
  check('a server fault says try again later', /later/i.test(upd.describeStatus(503, '')))

  console.log('\n=== redirects ===')

  script = [
    { status: 302, headers: { location: 'https://objects.githubusercontent.com/final' } },
    { status: 200, headers: {}, body: '{"ok":true}' },
  ]
  asked = []
  const followed = await upd.openStream('https://github.com/a', 500).then(res => {
    return new Promise(resolve => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => resolve(raw))
      res.on('error', () => resolve('error'))
    })
  }, e => 'rejected: ' + e.message)
  check('a 302 is followed', followed === '{"ok":true}', followed)
  check('and it followed it to the right place',
    asked[1] === 'https://objects.githubusercontent.com/final', asked)

  // GitHub uses 302 today; a CDN change to 307/308 used to write the
  // "Found. Redirecting to…" page into the .exe and then run it.
  script = [
    { status: 308, headers: { location: 'https://objects.githubusercontent.com/moved' } },
    { status: 200, headers: {}, body: '{"ok":true}' },
  ]
  const permanent = await upd.openStream('https://github.com/a', 500)
    .then(() => 'followed', e => 'rejected: ' + e.message)
  check('a 308 is followed too', permanent === 'followed', permanent)

  // The old code passed undefined to https.get, which silently defaulted to
  // localhost:443 — an app that runs its own web server must never be talked
  // into fetching an installer from itself.
  script = [{ status: 302, headers: {} }]
  asked = []
  const nowhere = await upd.openStream('https://github.com/a', 500)
    .then(() => 'resolved', e => e.message)
  check('a redirect with no destination is refused', nowhere !== 'resolved', nowhere)
  check('and nothing was fetched from localhost',
    !asked.some(u => /localhost|127\.0\.0\.1/.test(u)), asked)

  script = Array.from({ length: 10 }, (_, i) => ({
    status: 302, headers: { location: `https://github.com/hop${i + 1}` },
  }))
  const loop = await upd.openStream('https://github.com/hop0', 500)
    .then(() => 'resolved', e => e.message)
  check('a redirect loop is cut off rather than recursing for ever',
    /too many/i.test(String(loop)), loop)

  console.log('\n=== checking for updates end to end ===')

  const release = ver => JSON.stringify({
    tag_name: `v${ver}`,
    body: '- Something new',
    html_url: `https://github.com/abodan09/signage-manager/releases/tag/v${ver}`,
    assets: [
      { name: 'latest.yml', browser_download_url: 'https://github.com/x/latest.yml' },
      { name: `Signage-Manager-Setup-${ver}.exe`, browser_download_url: `https://github.com/x/S-${ver}.exe` },
    ],
  })

  script = [
    { status: 200, headers: {}, body: release('1.10.0') },
    { status: 200, headers: {}, body: `path: Signage-Manager-Setup-1.10.0.exe\nsha512: ABC==\nfiles:\n  - url: x\n    size: 1234\n` },
  ]
  const found = await upd.checkForUpdates()
  check('a newer release is offered', found.available === true && found.version === '1.10.0', found)
  check('with the installer the manifest names',
    found.downloadUrl === 'https://github.com/x/S-1.10.0.exe', found.downloadUrl)
  check('and the checksum to verify it against', found.sha512 === 'ABC==' && found.size === 1234, found)
  check('no error is reported on success', !found.error, found.error)

  script = [{ status: 200, headers: {}, body: release('1.9.0') }]
  const same = await upd.checkForUpdates()
  check('the same version is not offered', same.available === false && !same.error, same)

  // The headline bug: every failure used to be laundered into a green tick.
  script = [{ status: 403, headers: {}, body: JSON.stringify({ message: 'API rate limit exceeded' }) }]
  const limited = await upd.checkForUpdates()
  check('a rate-limited check is NOT reported as up to date', !!limited.error, limited)
  check('and the reason survives to the UI', /rate-limiting/i.test(String(limited.error)), limited.error)

  script = [{ status: 200, headers: {}, body: '{"no_tag":true}' }]
  const noTag = await upd.checkForUpdates()
  check('a reply with no version is an error, not "up to date"', !!noTag.error, noTag)

  script = [{ status: 200, headers: {}, body: 'not json at all' }]
  const junk = await upd.checkForUpdates()
  check('an unparseable reply is an error too', !!junk.error, junk)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  setTimeout(() => process.exit(fail ? 1 : 0), 300).unref()
}

main().catch(e => { console.error(e); process.exit(1) })
