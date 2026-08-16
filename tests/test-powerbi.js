/* Power BI: link parsing across the three shapes the portal produces, and the
   refusal of the one that cannot work on an unattended screen. */
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
const { parsePowerBi } = require(`${DIST}/apps/powerbi/index.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-pbi-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const R = 'eyJrIjoiYWJjZDEyMzQiLCJ0IjoiZWZnaCJ9'
const PUBLIC = `https://app.powerbi.com/view?r=${R}`
const PUBLIC_IFRAME = `<iframe title="Sales" width="1140" height="541.25" src="${PUBLIC}&amp;pageName=ReportSection" frameborder="0" allowFullScreen="true"></iframe>`
const SECURE = 'https://app.powerbi.com/reportEmbed?reportId=abc-123&autoAuth=true&ctid=def-456'
const REPORT = 'https://app.powerbi.com/groups/me/reports/abc-123/ReportSection2?experience=power-bi'

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

  console.log('\n=== the three link shapes the portal hands out ===')

  check('a publish-to-web link is recognised',
    parsePowerBi(PUBLIC)?.kind === 'public' && parsePowerBi(PUBLIC)?.url === PUBLIC)
  check('the whole iframe snippet works too',
    parsePowerBi(PUBLIC_IFRAME)?.kind === 'public', parsePowerBi(PUBLIC_IFRAME))
  check('&amp; in pasted HTML does not corrupt the link',
    !/&amp;/.test(parsePowerBi(PUBLIC_IFRAME)?.url ?? '&amp;'))

  const sec = parsePowerBi(SECURE)
  check('a secure embed link is recognised as such', sec?.kind === 'secure')
  check('and its report id is read', sec?.reportId === 'abc-123')

  const rep = parsePowerBi(REPORT)
  check('a plain portal report URL is recognised', rep?.kind === 'report')
  check('its group and report ids are read', rep?.groupId === 'me' && rep?.reportId === 'abc-123')

  check('a non-Power-BI URL is refused', parsePowerBi('https://example.com/view?r=x') === null)
  check('a lookalike domain is refused', parsePowerBi('https://app.powerbi.com.evil.test/view?r=x') === null)
  check('empty input is refused', parsePowerBi('') === null)

  console.log('\n=== a link that needs a human to sign in is refused, not warned ===')

  const pbi = getApp('powerbi')
  check('powerbi is registered', !!pbi)
  check('it declares no refresh hook', typeof pbi.refresh !== 'function')

  const good = sanitizeAppConfig(pbi, { link: PUBLIC, refreshMinutes: 30 })
  check('a publish-to-web link is accepted', good.ok === true, good.error)

  const secureCfg = sanitizeAppConfig(pbi, { link: SECURE })
  // Accepting this would put a Microsoft login page on a wall and nobody would
  // notice for days, so it fails at save time with the fix in the message.
  check('a secure embed link is rejected', secureCfg.ok === false)
  check('and the message says exactly what to do instead',
    /Publish to web/.test(secureCfg.error ?? ''), secureCfg.error)

  const reportCfg = sanitizeAppConfig(pbi, { link: REPORT })
  check('a plain portal URL is rejected too', reportCfg.ok === false)

  check('a missing link is rejected', sanitizeAppConfig(pbi, {}).ok === false)
  check('an absurd refresh interval is rejected',
    sanitizeAppConfig(pbi, { link: PUBLIC, refreshMinutes: 99999 }).ok === false)

  const note = pbi.fields.find(f => f.type === 'note')
  check('the config warns that publish-to-web is public',
    !!note && /anyone with the URL/i.test(note.help))

  console.log('\n=== the rendered page ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'powerbi', name: 'Sales board',
    config: { link: PUBLIC, refreshMinutes: 5, pageName: 'ReportSection2', background: '#101820' },
  })
  check('an instance is created without touching the network', made.status === 201, made.body)
  const id = made.body.instance.id

  const page = await text(`/tv/app/${id}`)
  check('the report URL reaches the page', page.includes('app.powerbi.com/view?r='))
  check('the toolbars are hidden by default', page.includes('chromeless=true') && page.includes('filterPaneEnabled=false'))
  check('the chosen page is requested', page.includes('pageName=ReportSection2'))
  check('the refresh interval is in milliseconds', page.includes('300000'))
  check('the letterbox colour is applied', page.includes('#101820'))

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))
  check('no CSS grid or flex gap', !/display\s*:\s*grid/.test(css) && !/[^-]gap\s*:/.test(css))
  // Assigning the same URL to an iframe is not guaranteed to re-navigate, and
  // a cached response would defeat the schedule entirely.
  check('it reloads by replacing the element', scripts.includes('removeChild'))
  check('and busts the cache each time', scripts.includes('_t=') && scripts.includes('Date.now()'))
  check('a report that never loads explains why', scripts.includes('function fail('))

  const noChrome = await call('POST', '/api/apps/instances', {
    appId: 'powerbi', name: 'With toolbars', config: { link: PUBLIC, hideChrome: false },
  })
  const page2 = await text(`/tv/app/${noChrome.body.instance.id}`)
  check('the toolbars can be kept', !page2.includes('chromeless=true'))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
