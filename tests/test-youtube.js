/* The YouTube app: link parsing across every shape an operator might paste,
   embed parameters, the offline poster fallback, and the end-of-video handback
   that lets a long film play past its playlist slot. */
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const ROOT = require('path').join(__dirname, '..').replace(/\\\\/g, '/')
const express = require(`${ROOT}/node_modules/express`)
const DIST = `${ROOT}/dist/main/server`
const { JsonDB } = require(`${DIST}/database.js`)
const { AppStore } = require(`${DIST}/apps/store.js`)
const { getApp } = require(`${DIST}/apps/registry.js`)
const { sanitizeAppConfig } = require(`${DIST}/apps/schema.js`)
const { parseYouTube } = require(`${DIST}/apps/youtube/index.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { createPlayerRouter } = require(`${DIST}/routes/player.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-yt-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const tvClients = new Map()

const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, tvClients, lanUrl))
app.use('/tv', createPlayerRouter('1.8.0'))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

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

  console.log('\n=== link parsing: whatever the operator pastes ===')

  const ID = 'a-8UFyRXBDg'
  const cases = [
    ['a plain watch URL', `https://www.youtube.com/watch?v=${ID}`, ID],
    ['no scheme', `www.youtube.com/watch?v=${ID}`, ID],
    ['a youtu.be share link', `https://youtu.be/${ID}`, ID],
    ['a youtu.be link with tracking', `https://youtu.be/${ID}?si=J_A2fHTYPfAHM2nm`, ID],
    ['a Shorts link', `https://youtube.com/shorts/${ID}`, ID],
    ['a Shorts link with tracking', `https://youtube.com/shorts/${ID}?si=TO8RGfmokQMdsI6R`, ID],
    ['an embed link', `https://www.youtube.com/embed/${ID}`, ID],
    ['a live link', `https://www.youtube.com/live/${ID}`, ID],
    ['a nocookie link', `https://www.youtube-nocookie.com/embed/${ID}`, ID],
    ['a bare video id', ID, ID],
    ['extra query parameters', `https://www.youtube.com/watch?app=desktop&v=${ID}&feature=share`, ID],
  ]
  cases.forEach(([label, input, want]) => {
    const got = parseYouTube(input)
    check(label + ' resolves to the video id', got && got.id === want, got)
  })

  check('a start time in the link is picked up',
    parseYouTube(`https://youtu.be/${ID}?t=90`)?.start === 90)
  check('an h/m/s start time is parsed',
    parseYouTube(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`)?.start === 3723)
  check('a playlist link is accepted',
    parseYouTube('https://www.youtube.com/playlist?list=PL1234567890')?.list === 'PL1234567890')
  check('a video inside a playlist keeps both',
    (() => { const r = parseYouTube(`https://www.youtube.com/watch?v=${ID}&list=PLabc`); return r?.id === ID && r?.list === 'PLabc' })())

  check('a non-YouTube URL is refused', parseYouTube('https://vimeo.com/12345') === null)
  check('a lookalike domain is refused', parseYouTube('https://youtube.com.evil.test/watch?v=' + ID) === null)
  check('empty input is refused', parseYouTube('') === null)
  check('junk is refused', parseYouTube('not a url at all') === null)

  console.log('\n=== config validation ===')

  const yt = getApp('youtube')
  check('youtube is registered', !!yt)

  const okCfg = sanitizeAppConfig(yt, { url: `https://youtu.be/${ID}`, caption: true })
  check('a valid config is accepted', okCfg.ok === true, okCfg.error)
  check('advanced defaults are filled', okCfg.ok && okCfg.config.playFull === true && okCfg.config.fit === 'contain')

  const badCfg = sanitizeAppConfig(yt, { url: 'https://vimeo.com/12345' })
  check('a non-YouTube link is rejected with an explanation',
    badCfg.ok === false && /YouTube link/.test(badCfg.error), badCfg.error)

  const noUrl = sanitizeAppConfig(yt, {})
  check('a missing URL is rejected', noUrl.ok === false)

  const jsUrl = sanitizeAppConfig(yt, { url: 'javascript:alert(1)' })
  check('a javascript: URL is rejected', jsUrl.ok === false)

  console.log('\n=== the rendered page ===')

  // Created without network: oEmbed will fail here, which is the offline case
  // and must still produce a usable page.
  const made = await call('POST', '/api/apps/instances', {
    appId: 'youtube', name: 'YouTube',
    config: { url: `https://youtube.com/shorts/${ID}`, caption: true, showTitle: true, fit: 'cover', startAt: 12 },
  })
  check('an instance is created even when YouTube is unreachable', made.status === 201, made.body)
  const id = made.body?.instance?.id

  const page = await text(`/tv/app/${id}`)
  check('the page embeds the video id from a Shorts link', page.includes(`/embed/${ID}`))
  check('autoplay is on', page.includes('autoplay=1'))
  check('it is muted, or autoplay would be blocked', page.includes('mute=1'))
  check('player chrome is hidden', page.includes('controls=0'))
  check('captions are requested when asked for', page.includes('cc_load_policy=1'))
  check('the start time is passed through', page.includes('start=12'))
  check('related videos are suppressed', page.includes('rel=0'))
  check('the js api is enabled so the end of the video is detectable', page.includes('enablejsapi=1'))

  const noCaption = await call('POST', '/api/apps/instances', {
    appId: 'youtube', name: 'No captions', config: { url: `https://youtu.be/${ID}`, caption: false },
  })
  const page2 = await text(`/tv/app/${noCaption.body.instance.id}`)
  check('captions are not forced when unticked', !page2.includes('cc_load_policy=1'))

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page script parses', parses)
  check('no arrow functions', !/=>/.test(scripts))
  check('no async/await', !/async function|await /.test(scripts))
  check('no optional chaining', !/\?\./.test(scripts))
  check('no CSS grid', !/display\s*:\s*grid/.test(css))
  check('no flex gap', !/[^-]gap\s*:/.test(css))
  check('it falls back to a poster rather than a black screen', scripts.includes('showFallback'))
  check('it reports the end of the video to the player', scripts.includes('signage:ended'))
  check('the handback is scoped to this instance', scripts.includes(id))

  console.log('\n=== the player accepts the handback, and only from itself ===')

  const player = await text('/tv/player')
  const pscripts = [...player.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  check('the player listens for the end-of-content message', pscripts.includes("'signage:ended'"))
  check('it rejects messages from another origin', pscripts.includes('evt.origin !== location.origin'))
  check('it ignores a message for a different instance', pscripts.includes('currentMainItem.appInstanceId !== d.instanceId'))
  let pparses = true
  try { new Function(pscripts) } catch (e) { pparses = false; console.log('   ', e.message) }
  check('the player still parses', pparses)
  check('the player is still ES5', !/=>|async function|\.padStart\(|\?\?/.test(pscripts))

  console.log('\n=== a video title becomes the asset name ===')

  // Stand in for oEmbed so the naming path can be exercised without the net.
  const fake = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ title: 'Bank Vault Tour', author_name: 'Water CERT', thumbnail_url: '' }))
  })
  await new Promise(r => fake.listen(0, r))
  const inst = db.getAppInstanceById(id)
  // Feed the cache directly: the naming rule is what is under test, not oEmbed.
  apps.invalidate(id)
  const store = apps
  store.getCached(id)
  db.updateAppInstance(id, { name: 'YouTube' })
  const ctxData = { id: ID, title: 'Bank Vault Tour', author: 'Water CERT' }
  fs.writeFileSync(path.join(dir, 'app-cache', `${id}.json`),
    JSON.stringify({ data: ctxData, fetchedAt: Date.now(), expiresAt: Date.now() + 60000 }))
  const reloaded = new AppStore(db, dir, assetsDir)
  check('the app offers the video title as a name',
    reloaded.suggestName(db.getAppInstanceById(id), base) === 'Bank Vault Tour')
  db.updateAppInstance(id, { name: 'Lobby loop' })
  check('a name the operator chose is still suggested against, not applied here',
    reloaded.suggestName(db.getAppInstanceById(id), base) === 'Bank Vault Tour')
  void inst
  fake.close()

  console.log(`\n${pass} passed, ${fail} failed`)
  server.close()
  process.exit(fail ? 1 : 0)
})
