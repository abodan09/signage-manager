/* Live TV with Ads: the timing rules that keep the feed visible, the source
   types and their traps, the rendered page, and the playlist JSON the advert
   overlay polls. */
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
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-livetv-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const tv = getApp('livetv')
const C = (o = {}) => ({
  sourceType: 'mp4',
  streamUrl: 'https://cam.example.com/live.mp4',
  adsProjectId: 'ads-1',
  intervalSeconds: 30, playSeconds: 10, restSeconds: 1,
  ...o,
})
const san = o => sanitizeAppConfig(tv, C(o))
const scriptsOf = html =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')

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

  console.log('\n=== registration ===')

  check('live tv is registered', !!tv)
  check('it is a media app', tv.category === 'media')
  check('it needs no network of its own', typeof tv.refresh !== 'function')
  // A live feed is not a slide: a short playlist duration tears it down and
  // reconnects, and the advert cycle restarts every time.
  check('it defaults to a long duration', tv.defaultDuration >= 600, tv.defaultDuration)
  const keys = tv.fields.map(f => f.key)
  check('every showIf points at a real field',
    tv.fields.filter(f => f.showIf).every(f => keys.indexOf(f.showIf.key) >= 0))
  // Capture over a plain-HTTP LAN origin cannot work on any TV player, so the
  // mode must not be offered at all rather than offered and disappointing.
  // (The words appear in the note that explains the absence, so this checks the
  // options themselves.)
  check('no capture-device source is offered',
    tv.fields.find(f => f.key === 'sourceType').options
      .every(o => !/capture|hdmi|webcam|device/i.test(o.value)))

  console.log('\n=== the advert must always leave the screen ===')

  check('the defaults are accepted', san().ok === true, san().error)
  check('play equal to the interval is refused', san({ playSeconds: 30 }).ok === false)
  check('and the message says why',
    /never leave/i.test(san({ playSeconds: 30 }).error || ''), san({ playSeconds: 30 }).error)
  check('play longer than the interval is refused',
    san({ intervalSeconds: 10, playSeconds: 20 }).ok === false)
  check('play plus rest overrunning the interval is refused',
    san({ intervalSeconds: 12, playSeconds: 10, restSeconds: 5 }).ok === false)
  check('a rest that exactly fits is accepted',
    san({ intervalSeconds: 12, playSeconds: 10, restSeconds: 2 }).ok === true)
  check('an interval below the floor is refused', san({ intervalSeconds: 2 }).ok === false)
  check('an absurd interval is refused', san({ intervalSeconds: 99999 }).ok === false)
  check('seconds are stored whole', san({ playSeconds: 7.6 }).config.playSeconds === 8)

  console.log('\n=== sources and their traps ===')

  check('a stream address is required', san({ streamUrl: '' }).ok === false)
  check('javascript: is refused', san({ streamUrl: 'javascript:alert(1)' }).ok === false)
  check('data: is refused', san({ streamUrl: 'data:text/html,<script>x</script>' }).ok === false)
  // Works on the machine it was configured on and nowhere else — the single
  // most valuable check here.
  check('a localhost address is refused',
    san({ streamUrl: 'http://localhost:8080/live.mp4' }).ok === false)
  check('127.0.0.1 is refused too',
    san({ streamUrl: 'http://127.0.0.1:8080/live.mp4' }).ok === false)
  check('a LAN address is fine',
    san({ streamUrl: 'http://192.168.1.50/live.mp4' }).ok === true)
  check('HLS without an .m3u8 address is refused',
    san({ sourceType: 'hls', streamUrl: 'https://x.example/live.mp4' }).ok === false)
  check('an .m3u8 address set to MP4 is refused',
    san({ sourceType: 'mp4', streamUrl: 'https://x.example/live.m3u8' }).ok === false)
  check('HLS with an .m3u8 address is accepted',
    san({ sourceType: 'hls', streamUrl: 'https://x.example/live.m3u8' }).ok === true)
  check('an .m3u8 with a query is still recognised',
    san({ sourceType: 'mp4', streamUrl: 'https://x.example/live.m3u8?token=a' }).ok === false)

  console.log('\n=== the playlist reference ===')

  check('an advert playlist is required', san({ adsProjectId: '' }).ok === false)
  check('a hostile id is refused', san({ adsProjectId: '../../etc/passwd' }).ok === false)
  check('a real id is accepted',
    san({ adsProjectId: '3f2b1a44-0c9e-4d21-bb10-77aa31c0de55' }).ok === true)

  console.log('\n=== only the fields in play are stored ===')

  const pctCfg = san({ sizeUnit: 'percent' }).config
  check('pixel sizes are dropped while sizing in percent', pctCfg.adWidthPx === undefined)
  check('percent sizes are kept', pctCfg.adWidthPct === 20)
  const pxCfg = san({ sizeUnit: 'pixel' }).config
  check('percent sizes are dropped while sizing in pixels', pxCfg.adWidthPct === undefined)
  check('pixel sizes are kept', pxCfg.adWidthPx === 384)
  check('the exact position is dropped unless chosen', san().config.customTop === undefined)
  check('and kept when it is', san({ position: 'custom' }).config.customTop === 70)
  check('an undeclared key is dropped', san({ sneaky: 'x' }).config.sneaky === undefined)

  console.log('\n=== the rendered page ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'livetv', name: 'Courtside', config: C({ position: 'bottom-right', animation: 'slide-up' }),
  })
  check('an instance saves', made.status === 201, made.body)
  const id = made.body.instance.id
  const page = await text(`/tv/app/${id}`)

  check('the page renders with no fetched data', page.includes('CFG'))
  // The markup carries no media of its own — the page builds the feed at
  // runtime once it knows which source type it was given.
  const markup = page.replace(/<script>[\s\S]*?<\/script>/g, '')
  check('the served markup has no media element of its own', !/<video|<img/.test(markup))
  // Two hardware decoders is one more than most signage panels have, so the
  // feed must be replaced wholesale and never added alongside itself.
  check('a reconnect replaces the feed rather than adding a second one',
    /feed\.innerHTML\s*=/.test(scriptsOf(page)) && !/feed\.appendChild/.test(scriptsOf(page)))
  check('the feed autoplays muted',
    /<video autoplay muted/.test(scriptsOf(page)))
  check('and inline, so a phone-class WebView does not go fullscreen',
    /playsinline/.test(scriptsOf(page)))
  check('video adverts are off unless explicitly allowed',
    tv.fields.find(f => f.key === 'allowVideoAds').default === false)
  check('the advert list is polled from the zone items route',
    page.includes(`/tv/zone/project/ads-1/items`))
  // The poll is an XHR from this page, so it has to be same-origin with the
  // address the screen actually used. A manager PC with a VPN or a second NIC
  // has several addresses, and its guess at the right one is only a guess —
  // guess wrong and the poll is blocked, silently, forever.
  check('the advert list is polled relatively, never at a guessed host',
    /"adsUrl":"\/tv\//.test(page), (page.match(/"adsUrl":"[^"]*"/) || [])[0])
  // The list arrives over the network, so the opening delay can elapse before
  // there is anything to show. Waiting a whole interval after that would mean
  // the first advert never lands when anyone is watching.
  check('the cycle starts when the adverts arrive, not on the timer alone',
    /maybeStart/.test(scriptsOf(page)) && /delayDone/.test(scriptsOf(page)))
  check('the stream address reaches the page', page.includes('cam.example.com/live.mp4'))

  const scripts = scriptsOf(page)
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5', !/=>|async function|await |\.padStart\(|\?\?|\?\.|Object\.(entries|values)\(/.test(scripts))
  check('it never fetches from the TV', !/\bfetch\(/.test(scripts))

  console.log('\n=== the video plane is left alone ===')

  // This is the first app page with a real <video> on it, so it is the first
  // that has to honour the player's rule: the hardware video hole is punched
  // from layout, and a transformed layer near it can blank the picture.
  check('no transform anywhere on the page', !/transform/.test(page))
  check('the advert moves by opacity and edges only',
    /transition:opacity/.test(page) && /left \.4s/.test(page))
  check('no inset shorthand', !/[^-]inset\s*:/.test(page))
  check('no CSS grid', !/display\s*:\s*grid/.test(page))
  check('no flex gap', !/[^-]gap\s*:/.test(page))
  check('no CSS custom properties', !page.includes('var(--'))
  check('no position:sticky', !/position\s*:\s*sticky/.test(page))
  check('no aspect-ratio', !/aspect-ratio\s*:/.test(page))
  // A movement started in the same frame the box stops being display:none
  // silently does not run on Chrome 53.
  check('the reflow that makes Chrome 53 animate at all is present',
    /offsetWidth/.test(scripts))

  console.log('\n=== each source builds the right element ===')

  const pageOf = async cfg => {
    const r = await call('POST', '/api/apps/instances', { appId: 'livetv', name: 'S', config: C(cfg) })
    return r.status === 201 ? text(`/tv/app/${r.body.instance.id}`) : `ERR ${JSON.stringify(r.body)}`
  }
  const hls = await pageOf({ sourceType: 'hls', streamUrl: 'https://x.example/live.m3u8' })
  check('HLS declares the Apple mime type so webOS picks its native pipeline',
    hls.includes('application/vnd.apple.mpegurl'))
  check('and probes for support rather than showing a black rectangle',
    hls.includes('canPlayType'))
  check('HLS is what the page is told to build', hls.includes('"sourceType":"hls"'))
  const mjpeg = await pageOf({ sourceType: 'mjpeg', streamUrl: 'http://cam.local/stream' })
  // MJPEG is the one source that never touches the hardware decoder, which
  // makes it the safe choice for a first install.
  check('MJPEG is what the page is told to build', mjpeg.includes('"sourceType":"mjpeg"'))
  check('and the img branch exists to build it', mjpeg.includes("'<img src=\"'"))
  const embed = await pageOf({ sourceType: 'embed', streamUrl: 'https://player.example/live' })
  check('an embedded page is allowed to autoplay', embed.includes('allow="autoplay'))

  console.log('\n=== safety ===')

  const nasty = await call('POST', '/api/apps/instances', {
    appId: 'livetv', name: '</script><script>alert(1)</script>', config: C(),
  })
  const nastyPage = await text(`/tv/app/${nasty.body.instance.id}`)
  check('a hostile instance name cannot close the script block',
    !/<\/script><script>alert/.test(nastyPage))
  check('no inline event handlers are emitted', !/<[a-z][^>]*\son[a-z]+\s*=/i.test(nastyPage))
  // This app can be dropped into a Split Screen zone, where several copies of a
  // page share one panel.
  check('it never registers as a screen', !/devices\/register/.test(page))
  check('and never opens a socket', !/WebSocket/.test(page))
  check('it never reports itself finished, which would cut the feed short',
    !/signage:ended/.test(page))

  console.log('\n=== the advert playlist route ===')

  const now = new Date().toISOString()
  db.insertProject({
    id: 'ads-1', name: 'House ads', durationSeconds: 8, scheduleMode: 'loop',
    isActive: true, orderIndex: 0, createdAt: now, updatedAt: now,
  })
  // Inserted out of order on purpose: getContentByProjectId does no sorting.
  db.insertContent({
    id: 'a2', name: 'Second', type: 'image', filePath: '/uploads/b.jpg', projectId: 'ads-1',
    durationSeconds: 5, scheduleMode: 'loop', isActive: true, orderIndex: 1, createdAt: now, updatedAt: now,
  })
  db.insertContent({
    id: 'a1', name: 'First', type: 'image', filePath: '/uploads/a.jpg', projectId: 'ads-1',
    durationSeconds: 5, scheduleMode: 'loop', isActive: true, orderIndex: 0, createdAt: now, updatedAt: now,
  })
  db.insertContent({
    id: 'a3', name: 'Paused', type: 'image', filePath: '/uploads/c.jpg', projectId: 'ads-1',
    durationSeconds: 5, scheduleMode: 'loop', isActive: false, orderIndex: 2, createdAt: now, updatedAt: now,
  })
  db.insertContent({
    id: 'a4', name: 'Hostile', type: 'html', htmlUrl: 'javascript:alert(1)', projectId: 'ads-1',
    durationSeconds: 5, scheduleMode: 'loop', isActive: true, orderIndex: 3, createdAt: now, updatedAt: now,
  })

  const itemsRes = await fetch(`${base}/tv/zone/project/ads-1/items`)
  const items = await itemsRes.json()
  check('the route serves the playlist', itemsRes.status === 200)
  check('it is never cached', itemsRes.headers.get('cache-control') === 'no-store')
  check('items come back in playlist order',
    items.items.map(i => i.src).join('|').indexOf('a.jpg') <
    items.items.map(i => i.src).join('|').indexOf('b.jpg'))
  check('paused items are left out', !JSON.stringify(items).includes('c.jpg'))
  // htmlUrl is stored unvalidated, and a javascript: iframe src runs in the
  // embedding page's origin.
  check('an item with a javascript: address is dropped',
    !JSON.stringify(items).includes('javascript:'))
  // Relative so they resolve against whatever address the screen used.
  check('media paths are relative to the manager', items.items[0].src === '/uploads/a.jpg')
  check('the playlist active flag is reported', items.projectActive === true)
  check('an unknown playlist 404s', (await fetch(`${base}/tv/zone/project/nope/items`)).status === 404)

  console.log('\n=== the zone player still behaves as it did ===')

  const zone = await text('/tv/zone/project/ads-1')
  check('the zone player still serves the playlist', zone.includes('/uploads/a.jpg'))
  check('still in order', zone.indexOf('a.jpg') < zone.indexOf('b.jpg'))
  check('still excluding paused items', !zone.includes('c.jpg'))
  check('still serving media paths the zone page can resolve', zone.includes('/uploads/a.jpg'))
  check('and the item duration still wins over the playlist default', zone.includes('"seconds":5'))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
