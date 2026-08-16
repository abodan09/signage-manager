/* Runs every integration suite against the COMPILED output in dist/.
   Build first:  npm run build
   Then:         npm test                                                   */
const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const SUITES = [
  ['device groups',      'test-groups.js'],
  ['screen pairing',     'test-pairing.js'],
  ['templates',          'test-templates.js'],
  ['designs & packs',    'test-designs.js'],
  ['apps & instagram',   'test-apps.js'],
  ['server security',    'test-server-security.js'],
  ['player compat',      'test-player-compat.js'],
]

if (!fs.existsSync(path.join(__dirname, '..', 'dist', 'main', 'server', 'index.js'))) {
  console.error('dist/ is missing — run `npm run build` first.')
  process.exit(1)
}

let total = 0, failed = 0, broken = []

for (const [label, file] of SUITES) {
  process.stdout.write(`\n──────── ${label} ────────\n`)
  let out = ''
  let ok = true
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf-8' })
  } catch (e) {
    ok = false
    out = (e.stdout || '') + (e.stderr || '')
  }
  process.stdout.write(out)
  const m = out.match(/(\d+) passed, (\d+) failed/)
  if (m) {
    total += Number(m[1])
    failed += Number(m[2])
    if (Number(m[2]) > 0) broken.push(label)
  } else {
    broken.push(`${label} (no summary — crashed?)`)
    failed++
  }
  if (!ok && !m) broken.push(label)
}

console.log('\n════════════════════════════════════════')
console.log(`${total} assertions passed, ${failed} failed`)
if (broken.length) {
  console.log('failing suites: ' + [...new Set(broken)].join(', '))
  process.exit(1)
}
console.log('all suites green')
