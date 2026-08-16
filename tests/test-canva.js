/* The Canva app: parsing whatever the operator pasted, page cycling, and the
   fact that it deliberately needs no manager-side fetch. */
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
const { parseCanva } = require(`${DIST}/apps/canva/index.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-canva-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const ID = 'DAGEeicsK0o', TOK = 'aX6RRPgeWRIIHM0DybtIJw'
const EMBED = '<iframe loading="lazy" style="position: absolute; width: 100%; height: 100%; top: 0; left: 0; '
  + 'border: none; padding: 0;margin: 0;" '
  + `src="https://www.canva.com/design/${ID}/${TOK}/view?embed" `
  + 'allowfullscreen="allowfullscreen" allow="fullscreen"></iframe>'

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

  console.log('\n=== parsing whatever was pasted ===')

  const want = `https://www.canva.com/design/${ID}/${TOK}/view?embed`
  check('the full embed snippet is understood', parseCanva(EMBED)?.url === want, parseCanva(EMBED))
  check('a plain design link works too',
    parseCanva(`https://www.canva.com/design/${ID}/${TOK}/view`)?.url === want)
  // Share links carry tracking, and /watch and /edit do not embed at all — the
  // URL is rebuilt rather than reused so all three land on the same place.
  check('utm tracking is stripped',
    parseCanva(`https://www.canva.com/design/${ID}/${TOK}/view?utm_content=DAF&utm_campaign=share`)?.url === want)
  check('a /watch link is rewritten to /view?embed',
    parseCanva(`https://www.canva.com/design/${ID}/${TOK}/watch`)?.url === want)
  check('an /edit link is rewritten too',
    parseCanva(`https://www.canva.com/design/${ID}/${TOK}/edit`)?.url === want)
  check('an embed link that already has the fragment is normalised',
    parseCanva(`https://www.canva.com/design/${ID}/${TOK}/view?embed#2`)?.url === want)

  check('a non-Canva URL is refused', parseCanva('https://example.com/design/a/b') === null)
  check('a lookalike domain is refused', parseCanva('https://canva.com.evil.test/design/a/b') === null)
  check('empty input is refused', parseCanva('') === null)
  check('prose without a link is refused', parseCanva('please show my canva design') === null)

  console.log('\n=== config ===')

  const cv = getApp('canva')
  check('canva is registered', !!cv)
  check('it needs no account', !cv.provider)
  // Nothing to fetch: the design lives at Canva and the screen loads it direct.
  check('it declares no refresh hook', typeof cv.refresh !== 'function')

  const ok = sanitizeAppConfig(cv, { embed: EMBED, pages: 3, pageSeconds: 15 })
  check('a valid config is accepted', ok.ok === true, ok.error)
  check('defaults fill in', ok.ok && ok.config.background === '#ffffff' && ok.config.startPage === 1)

  const bad = sanitizeAppConfig(cv, { embed: 'https://vimeo.com/1' })
  check('a non-Canva embed is rejected with instructions',
    bad.ok === false && /Share/.test(bad.error), bad.error)
  check('a missing embed is rejected', sanitizeAppConfig(cv, {}).ok === false)
  check('a start page beyond the page count is rejected',
    sanitizeAppConfig(cv, { embed: EMBED, pages: 2, startPage: 5 }).ok === false)
  check('too many pages is rejected', sanitizeAppConfig(cv, { embed: EMBED, pages: 500 }).ok === false)

  console.log('\n=== the rendered page ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'canva', name: 'Lobby deck',
    config: { embed: EMBED, pages: 4, pageSeconds: 12, advanceAfterPass: true, background: '#101820' },
  })
  check('an instance is created without touching the network', made.status === 201, made.body)
  const id = made.body.instance.id

  const page = await text(`/tv/app/${id}`)
  check('the embed URL is rebuilt into the page', page.includes(`/design/${ID}/${TOK}/view?embed`))
  check('the letterbox colour is applied', page.includes('#101820'))
  check('no utm parameters survive', !/utm_/.test(page))

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))
  check('no CSS grid or flex gap', !/display\s*:\s*grid/.test(css) && !/[^-]gap\s*:/.test(css))

  // Canva embeds never advance themselves; the documented workaround is one
  // asset per page. This app cycles them instead.
  check('it cycles pages by itself', scripts.includes('showPage') && scripts.includes('advance'))
  check('the iframe element is replaced, not just its fragment',
    scripts.includes('removeChild') && scripts.includes("createElement('iframe')"))
  check('it hands back to the playlist after one pass when asked',
    scripts.includes('signage:ended'))
  check('the handback names this instance', scripts.includes(id))
  check('a design that never loads explains why', scripts.includes('function fail('))

  const single = await call('POST', '/api/apps/instances', {
    appId: 'canva', name: 'One pager', config: { embed: EMBED, pages: 1 },
  })
  const singlePage = await text(`/tv/app/${single.body.instance.id}`)
  check('a one-page design pins no fragment', /CFG.pages > 1 \? '#'/.test(singlePage))

  console.log('\n=== it is honest about needing the internet ===')
  const def = getApp('canva')
  const note = def.fields.find(f => f.type === 'note')
  check('the config explains the offline trade-off', !!note && /offline|Content Library/i.test(note.help))
  check('and points at the export route as the reliable one',
    !!note && /export/i.test(note.help))

  console.log(`\n${pass} passed, ${fail} failed`)
  // Let the process end on its own once the listener and the fetch keep-alive
  // pool have drained. Calling process.exit() mid-teardown trips a libuv
  // assertion on Windows and reports a failure for a suite that passed. The
  // unref'd timer only fires if something is still holding the loop open.
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
