/* Static analysis of the served player page against the webOS 4 / Chrome 53
   floor. This is the only automated guard on a 700-line template literal that
   has no linting and no type checking. */
const Module = require('module')
const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const STUB = path.join(__dirname, 'electron-stub.js')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'electron') return STUB
  try { return origResolve.call(this, request, parent, ...rest) }
  catch (e) {
    if (/^[a-z@]/.test(request)) return origResolve.call(this, path.join(ROOT, 'node_modules', request), parent, ...rest)
    throw e
  }
}

const { startServer } = require(`${ROOT}/dist/main/server/index.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

;(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-compat-'))
  const port = await startServer(userData, 3801, '1.7.0')
  const html = await (await fetch(`http://127.0.0.1:${port}/tv/player`)).text()

  // Only the inline script, so CSS/text can't create false positives.
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')

  console.log('\n=== JS syntax ===')
  let syntaxOk = true
  try { new Function(scripts) } catch (e) { syntaxOk = false; console.log('   ', e.message) }
  check('player script parses', syntaxOk)

  console.log('\n=== ES2016+ features that throw on Chrome 53 ===')
  const banned = [
    ['.padStart(',      'String.padStart (ES2017)'],
    ['.padEnd(',        'String.padEnd (ES2017)'],
    ['Object.entries(', 'Object.entries (ES2017)'],
    ['Object.values(',  'Object.values (ES2017)'],
    ['async function',  'async functions (ES2017)'],
    ['await ',          'await (ES2017)'],
    ['.finally(',       'Promise.finally (Chrome 63)'],
    ['?.',              'optional chaining (Chrome 80)'],
    ['??',              'nullish coalescing (Chrome 80)'],
    ['=>',              'arrow functions (fine in 53, but the file style is ES5)'],
    ['`',               'template literals (fine in 53, but breaks the server-side literal)'],
  ]
  for (const [needle, label] of banned) {
    // arrow functions and backticks are style/safety, not correctness on 53
    const isHardError = !['=>', '`'].includes(needle)
    const present = scripts.includes(needle)
    if (isHardError) check(`no ${label}`, !present)
    else if (present) console.log(`  NOTE  ${label} present`)
    else console.log(`  PASS  no ${label}`)
  }

  console.log('\n=== CSS the TV WebViews drop ===')
  // Strip comments first â€” the file documents these very rules in prose.
  const css = ((html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '').replace(/\/\*[\s\S]*?\*\//g, '')
  check('no `inset:` shorthand (Chromium < 87 collapses the layer)', !/[^-]inset\s*:/.test(css))
  check('no flexbox `gap` (unsupported in Chrome 53 flex)', !/[^-]gap\s*:/.test(css))
  check('no CSS grid', !/display\s*:\s*grid/.test(css))
  check('no aspect-ratio property', !/aspect-ratio\s*:/.test(css))
  check('no position:sticky', !/position\s*:\s*sticky/.test(css))
  check('no CSS custom properties in the player', !/var\(--/.test(css))

  console.log('\n=== template engine present and safe ===')
  check('applyTemplate exists', scripts.includes('function applyTemplate('))
  check('zones write explicit edges', scripts.includes("s.left") && scripts.includes("s.bottom"))
  check('no transform used for layout (breaks TV video planes)', !/style\.transform\s*=/.test(scripts))
  check('template cached for offline boot', scripts.includes("localStorage.setItem('signage_template'"))
  check('preview mode short-circuits registration', scripts.includes('PREVIEW'))
  check('playlist callback is guarded from the retry loop', scripts.includes('Playback error'))

  console.log('\n=== the rotation cannot be stranded by the progress bar ===')
  // startProgress() used to run BEFORE the next-item timer was scheduled, so
  // anything it threw stopped the wall on whatever was showing. Two halves to
  // that fix, and both are pinned here. performance.now() is the specific throw
  // we know about: VIDAA's developer guide lists High-Resolution Timestamp as
  // unsupported, and it is absent on some TV WebViews.
  // Comments survive into the served script, and the fallback's own comment
  // names performance.now() — strip commentary before hunting for real calls.
  const codeOnly = scripts.replace(/^[ \t]*\/\/.*$/gm, '')
  const withoutNowHelper = codeOnly.replace(/function now\(\)\s*\{[\s\S]*?\}/, '')
  check('performance.now() has a Date.now() fallback',
    /function now\(\)\s*\{[\s\S]*?Date\.now\(\)/.test(scripts))
  check('no unguarded performance.now() in the player',
    !/performance\.now/.test(withoutNowHelper))
  check('the next-item timer is scheduled before the progress bar',
    !/startProgress\([^)]*\);\s*[\r\n]+\s*mainTimer\s*=/.test(scripts))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
