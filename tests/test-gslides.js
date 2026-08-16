/* Google Slides: telling a published deck from a private one, and owning the
   timing parameters so the operator never has to republish. */
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
const { parseGoogleSlides } = require(`${DIST}/apps/gslides/index.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-gs-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const PUB = '2PACX-1vTFOUByYxPSx3cn7z3yBzxx7Ocv0u4qn9u'
const DOC = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
// Exactly what Google's Publish to the web dialog produces.
const PUB_LINK = `https://docs.google.com/presentation/d/e/${PUB}/pub?start=true&loop=true&delayms=5000`
const PUB_IFRAME = `<iframe src="https://docs.google.com/presentation/d/e/${PUB}/embed?start=true&amp;loop=true&amp;delayms=3000" frameborder="0" width="960" height="569" allowfullscreen="true"></iframe>`
const EDIT_LINK = `https://docs.google.com/presentation/d/${DOC}/edit#slide=id.p`

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

  console.log('\n=== published or private: the /e/ is the whole difference ===')

  const p = parseGoogleSlides(PUB_LINK)
  check('a published link is recognised', p?.kind === 'published' && p.id === PUB, p)
  check('it is normalised to the embed form, without Google chrome',
    p?.url === `https://docs.google.com/presentation/d/e/${PUB}/embed`)
  check('the whole iframe snippet works too', parseGoogleSlides(PUB_IFRAME)?.kind === 'published')
  check('&amp; in pasted HTML does not corrupt it',
    !/&amp;/.test(parseGoogleSlides(PUB_IFRAME)?.url ?? '&amp;'))
  // The timing in the pasted link is discarded — this app writes its own.
  check('timing parameters from the pasted link are dropped',
    !/delayms/.test(parseGoogleSlides(PUB_LINK)?.url ?? 'delayms'))

  const e = parseGoogleSlides(EDIT_LINK)
  check('an editing link is recognised as private', e?.kind === 'private' && e.id === DOC)

  check('a non-Slides URL is refused', parseGoogleSlides('https://example.com/presentation/d/e/x') === null)
  check('a Google Docs document is refused',
    parseGoogleSlides('https://docs.google.com/document/d/e/abc/pub') === null)
  check('a lookalike domain is refused',
    parseGoogleSlides('https://docs.google.com.evil.test/presentation/d/e/abc/pub') === null)
  check('empty input is refused', parseGoogleSlides('') === null)

  console.log('\n=== a link a screen cannot open is refused at save time ===')

  const gs = getApp('gslides')
  check('gslides is registered', !!gs)
  check('it declares no refresh hook', typeof gs.refresh !== 'function')

  const good = sanitizeAppConfig(gs, { link: PUB_LINK, secondsPerSlide: 8 })
  check('a published link is accepted', good.ok === true, good.error)

  const priv = sanitizeAppConfig(gs, { link: EDIT_LINK })
  check('an editing link is rejected', priv.ok === false)
  check('and the message names the menu path that works',
    /Publish to the web/.test(priv.error ?? ''), priv.error)

  check('a missing link is rejected', sanitizeAppConfig(gs, {}).ok === false)
  check('an absurd slide duration is rejected',
    sanitizeAppConfig(gs, { link: PUB_LINK, secondsPerSlide: 9999 }).ok === false)
  // Without a slide count the app cannot know when a pass finishes, so it
  // refuses rather than guessing and handing back at the wrong moment.
  check('moving on after a pass needs the slide count',
    sanitizeAppConfig(gs, { link: PUB_LINK, advanceAfterPass: true }).ok === false)
  check('and is happy once it has one',
    sanitizeAppConfig(gs, { link: PUB_LINK, advanceAfterPass: true, slideCount: 12 }).ok === true)

  const note = gs.fields.find(f => f.type === 'note')
  check('the config warns that publishing is public', !!note && /anyone with the URL/i.test(note.help))
  check('and says the timing is set here, not in Google', !!note && /republish/i.test(note.help))

  console.log('\n=== the rendered page owns the timing ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'gslides', name: 'Company deck',
    config: { link: PUB_LINK, secondsPerSlide: 8, loop: true, reloadMinutes: 30, background: '#101820' },
  })
  check('an instance is created without touching the network', made.status === 201, made.body)
  const id = made.body.instance.id

  const page = await text(`/tv/app/${id}`)
  check('the embed URL reaches the page', page.includes(`/presentation/d/e/${PUB}/embed`))
  check('the slideshow starts by itself', page.includes('start=true'))
  check('looping is on', page.includes('loop=true'))
  // 8 seconds from our config, not the 5 baked into the pasted link.
  check('the dwell comes from our setting, not the pasted link',
    page.includes('delayms=8000') && !page.includes('delayms=5000'))
  check('the reload interval is in milliseconds', page.includes('1800000'))
  check('the letterbox colour is applied', page.includes('#101820'))

  const noLoop = await call('POST', '/api/apps/instances', {
    appId: 'gslides', name: 'Once through', config: { link: PUB_LINK, loop: false },
  })
  check('looping can be turned off',
    (await text(`/tv/app/${noLoop.body.instance.id}`)).includes('loop=false'))

  const pass1 = await call('POST', '/api/apps/instances', {
    appId: 'gslides', name: 'One pass',
    config: { link: PUB_LINK, secondsPerSlide: 5, advanceAfterPass: true, slideCount: 10 },
  })
  const passPage = await text(`/tv/app/${pass1.body.instance.id}`)
  // 10 slides x 5s, plus one slide's grace so the last is actually seen.
  check('a full pass is timed from slides x dwell', passPage.includes('55000'), passPage.match(/passMs":\d+/)?.[0])
  check('and hands back to the playlist', passPage.includes('signage:ended'))
  check('the handback names this instance', passPage.includes(pass1.body.instance.id))
  // The handback code is always emitted and guarded at runtime, so the guard
  // is what proves it stays off.
  check('an instance without that setting never hands back', page.includes('"passMs":0'))

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))
  check('no CSS grid or flex gap', !/display\s*:\s*grid/.test(css) && !/[^-]gap\s*:/.test(css))
  check('a deck that never loads explains why', scripts.includes('function fail('))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
