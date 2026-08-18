/* Social Mix: one wall fed by three networks. Covers the RSS reader (the only
   route into X that costs nothing), the merge and its per-source failure
   isolation, per-post badging, and the promise that adding all of this did not
   change what a single-network wall draws. */
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
const { parseRssFeed, fetchAnyFeed } = require(`${DIST}/apps/social/sources.js`)
const { MIX_GLYPH, PLATFORM_GLYPHS, PLATFORM_TINTS, SOCIAL_WALL_JS } = require(`${DIST}/apps/social/wall.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-mix-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')

const ago = mins => new Date(Date.now() - mins * 60e3)

/* Stands in for the two shapes an operator can paste: a wall service's JSON
   and a bridge's RSS. */
const upstream = http.createServer((req, res) => {
  const me = `http://127.0.0.1:${upstream.address().port}`
  if (req.url.indexOf('/img') === 0) {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    res.end(PNG); return
  }
  if (req.url.indexOf('/dead') === 0) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'the feed is having a day' } })); return
  }
  if (req.url.indexOf('/notafeed') === 0) {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!DOCTYPE html><html><body>User not found</body></html>'); return
  }
  if (req.url.indexOf('/x.rss') === 0) {
    res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' })
    res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Fan of Sony / @fanofsony</title>
  <image><url>${me}/img/avatar.png</url></image>
  <item>
    <title>Those were the days! https://x.com/i/status/1</title>
    <dc:creator>@fanofsony</dc:creator>
    <description><![CDATA[<p>Those were the days!</p><img src="${me}/img/1.png" />]]></description>
    <pubDate>${ago(60).toUTCString()}</pubDate>
    <guid isPermaLink="false">111</guid>
    <link>${me}/fanofsony/status/111#m</link>
  </item>
  <item>
    <title>No picture on this one, just words &amp; an ampersand.</title>
    <dc:creator>@fanofsony</dc:creator>
    <description><![CDATA[<p>No picture on this one, just words &amp; an ampersand.</p>]]></description>
    <pubDate>${ago(120).toUTCString()}</pubDate>
    <guid isPermaLink="false">222</guid>
    <link>${me}/fanofsony/status/222#m</link>
  </item>
  <item>
    <title>R to @someoneelse: agreed, completely</title>
    <dc:creator>@fanofsony</dc:creator>
    <description><![CDATA[<p>agreed, completely</p>]]></description>
    <pubDate>${ago(30).toUTCString()}</pubDate>
    <guid isPermaLink="false">333</guid>
    <link>${me}/fanofsony/status/333#m</link>
  </item>
</channel>
</rss>`)
    return
  }
  // Behold-shaped JSON, the Instagram route.
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    username: 'fanofsony', fullName: 'Fan of Sony',
    profilePictureUrl: `${me}/img/a.png`,
    posts: [
      { id: 'i1', mediaType: 'IMAGE', mediaUrl: `${me}/img/2.png`,
        caption: 'From the archive', timestamp: ago(10).toISOString() },
      { id: 'i2', mediaType: 'IMAGE', mediaUrl: `${me}/img/3.png`,
        caption: 'And another', timestamp: ago(200).toISOString() },
    ],
  }))
})

const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/app-media', express.static(apps.mediaPath))
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const server = app.listen(0, () => upstream.listen(0, async () => {
  const base = lanUrl()
  const up = `http://127.0.0.1:${upstream.address().port}`
  const IG = `${up}/ig.json`
  const RSS = `${up}/x.rss`
  const call = async (m, u, b) => {
    const res = await fetch(base + u, {
      method: m, headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, body: json }
  }
  const text = async u => (await fetch(base + u)).text()

  console.log('\n=== the app is registered ===')

  const mix = getApp('socialmix'), ig = getApp('instagram')
  check('social mix is registered', !!mix)
  check('it is a social app', mix.category === 'social')
  const modes = f => (f.fields.find(x => x.key === 'displayMode').options || []).map(o => o.value).join(',')
  check('it offers the same display modes as the single-network walls', modes(mix) === modes(ig), modes(mix))
  check('it needs no connected account', !mix.provider)
  // Every numeric and colour field must carry a default, or an untouched box
  // reaches render() as an empty string rather than a number.
  const numeric = mix.fields.filter(f => ['number', 'slider', 'color'].includes(f.type))
  check('every numeric and colour field has a default', numeric.every(f => f.default !== undefined),
    numeric.filter(f => f.default === undefined).map(f => f.key))
  check('every showIf points at a field that exists',
    mix.fields.every(f => !f.showIf || mix.fields.some(o => o.key === f.showIf.key)))

  console.log('\n=== config ===')

  check('a single feed link is enough',
    sanitizeAppConfig(mix, { instagramFeed: IG, displayMode: 'wall', theme: 'dark' }).ok === true)
  check('no feed links at all is refused', sanitizeAppConfig(mix, { displayMode: 'wall' }).ok === false)
  check('a javascript: feed link is refused',
    sanitizeAppConfig(mix, { twitterFeed: 'javascript:alert(1)' }).ok === false)
  check('a QR code with nowhere to point is refused',
    sanitizeAppConfig(mix, { instagramFeed: IG, showQr: true }).ok === false)
  check('a QR code with a target is accepted',
    sanitizeAppConfig(mix, { instagramFeed: IG, showQr: true, qrUrl: 'https://example.com' }).ok === true)

  console.log('\n=== reading RSS ===')

  const rss = await fetchAnyFeed(RSS)
  check('an RSS link is read without being told it is RSS', rss.posts.length === 3, rss.posts.length)
  check('the handle comes off dc:creator', rss.posts[0].username === 'fanofsony', rss.posts[0].username)
  check('the display name comes off the channel title', rss.posts[0].displayName === 'Fan of Sony',
    rss.posts[0].displayName)
  check('the picture is dug out of the CDATA description', /\/img\/1\.png$/.test(rss.posts[0].imageUrl),
    rss.posts[0].imageUrl)
  const textOnly = rss.posts.find(p => p.id === '222')
  check('a post with no picture survives with none', !!textOnly && textOnly.imageUrl === '')
  check('entities in the text are decoded', !!textOnly && textOnly.caption.indexOf('words & an') !== -1,
    textOnly && textOnly.caption)
  check('the tweet id is the post id', rss.posts.some(p => p.id === '111'))
  check('pubDate becomes a real timestamp', !isNaN(Date.parse(rss.posts[0].timestamp)))

  // The bridge proxies pictures and links through itself; both are sent home.
  const proxied = parseRssFeed(`<?xml version="1.0"?><rss><channel><title>NASA / @NASA</title>
    <item><title>Spacewalk today</title><dc:creator>@NASA</dc:creator>
    <description><![CDATA[<p>Spacewalk today</p><img src="https://bridge.example/pic/media%2FHP7sh5RWMAAVcuA.jpg" />]]></description>
    <pubDate>Tue, 18 Aug 2026 11:00:38 GMT</pubDate>
    <guid isPermaLink="false">999</guid>
    <link>https://bridge.example/NASA/status/999#m</link></item>
    </channel></rss>`, 'https://bridge.example/NASA/rss')
  check('a proxied picture is unwrapped to the network CDN',
    proxied.posts[0].imageUrl === 'https://pbs.twimg.com/media/HP7sh5RWMAAVcuA.jpg', proxied.posts[0].imageUrl)
  check('a proxied permalink is sent back to x.com',
    proxied.posts[0].permalink === 'https://x.com/NASA/status/999', proxied.posts[0].permalink)

  // A picture path that merely looks proxied, on some other host, is left be.
  const foreign = parseRssFeed(`<?xml version="1.0"?><rss><channel><title>A Blog</title>
    <item><title>Post</title><description><![CDATA[<img src="https://cdn.example/pic/media/x.jpg" />]]></description>
    <pubDate>Tue, 18 Aug 2026 11:00:38 GMT</pubDate></item></channel></rss>`, 'https://blog.example/rss')
  check('a lookalike path on another host is left alone',
    foreign.posts[0].imageUrl === 'https://cdn.example/pic/media/x.jpg', foreign.posts[0].imageUrl)

  const asHtml = await fetchAnyFeed(`${up}/notafeed`).catch(e => e.message)
  check('a web page is refused with a readable message', /web page/i.test(String(asHtml)), asHtml)

  // fromCodePoint throws above U+10FFFF, and one bad entity must not cost the
  // operator the whole feed.
  let nasty = null
  try {
    nasty = parseRssFeed(`<?xml version="1.0"?><rss><channel><title>T / @t</title>
      <item><title>Out of range &#9999999; and &#x7FFFFF; but still a post</title>
      <pubDate>Tue, 18 Aug 2026 11:00:38 GMT</pubDate></item></channel></rss>`, 'https://x.example/rss')
  } catch (e) { console.log('   ', e.message) }
  check('an impossible numeric entity does not abort the feed', !!nasty && nasty.posts.length === 1)
  check('and the undecodable entity is left standing as text',
    !!nasty && nasty.posts[0].caption.indexOf('&#9999999;') !== -1, nasty && nasty.posts[0].caption)

  // A picture address is written into a style attribute, where esc() would be
  // the wrong tool; it goes through safeUrl instead.
  check('picture addresses are sanitised before reaching a style attribute',
    /safeUrl\(p\.image\)/.test(SOCIAL_WALL_JS) && /safeUrl\(p\.avatar\)/.test(SOCIAL_WALL_JS))
  check('no picture address is interpolated raw',
    !/url\(\\'' \+ p\.(image|avatar)/.test(SOCIAL_WALL_JS))

  console.log('\n=== the mix ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'socialmix', name: 'Social Mix',
    config: { instagramFeed: IG, twitterFeed: RSS, displayMode: 'wall', theme: 'dark' },
  })
  check('an instance is created and fetches', made.status === 201 && !made.body.instance.lastError,
    made.body && made.body.instance && made.body.instance.lastError)
  const id = made.body.instance.id

  const data = (await call('GET', `/tv/app/${id}/data`)).body.data
  const platforms = data.posts.map(p => p.platform)
  check('both networks reach the wall',
    platforms.indexOf('instagram') !== -1 && platforms.indexOf('twitter') !== -1, platforms)
  check('every post is badged with where it came from', platforms.every(Boolean), platforms)
  check('replies are dropped by default', !data.posts.some(p => /^R to @/.test(p.caption)))
  check('the newest post is first',
    Date.parse(data.posts[0].timestamp) >= Date.parse(data.posts[data.posts.length - 1].timestamp))
  check('pictures are mirrored onto the manager',
    data.posts.filter(p => p.image).every(p => /\/app-media\//.test(p.image)),
    data.posts.map(p => p.image))
  check('a text post carries no picture rather than a broken one',
    data.posts.some(p => p.image === '' && p.caption))
  check('avatars are mirrored', data.posts.every(p => !p.avatar || /\/app-media\//.test(p.avatar)))

  console.log('\n=== one dead feed does not take the others down ===')

  const partial = await call('POST', '/api/apps/instances', {
    appId: 'socialmix', name: 'Half broken',
    config: { instagramFeed: IG, facebookFeed: `${up}/dead`, displayMode: 'wall' },
  })
  check('the instance still fetches', partial.status === 201 && !partial.body.instance.lastError,
    partial.body && partial.body.instance && partial.body.instance.lastError)
  const partialData = (await call('GET', `/tv/app/${partial.body.instance.id}/data`)).body.data
  check('the working feed still fills the wall', partialData.posts.length > 0)
  check('nothing from the dead feed is shown',
    !partialData.posts.some(p => p.platform === 'facebook'))

  const cached = apps.getCached(partial.body.instance.id)
  const fbSource = cached.data.sources.find(s => s.platform === 'facebook')
  check('the failure is recorded against the source that failed', !!fbSource && fbSource.ok === false)
  check('and it says why', !!fbSource && /having a day|500/.test(String(fbSource.error)), fbSource && fbSource.error)

  const allDead = await call('POST', '/api/apps/instances', {
    appId: 'socialmix', name: 'All broken',
    config: { facebookFeed: `${up}/dead`, displayMode: 'wall' },
  })
  check('an instance with nothing readable reports the error',
    !!allDead.body.instance.lastError, allDead.body.instance.lastError)

  console.log('\n=== per-source cap and ordering ===')

  const capped = await call('POST', '/api/apps/instances', {
    appId: 'socialmix', name: 'Capped',
    config: { instagramFeed: IG, twitterFeed: RSS, perSource: 1, mixOrder: 'roundrobin' },
  })
  const cappedData = (await call('GET', `/tv/app/${capped.body.instance.id}/data`)).body.data
  check('the cap is applied per network', cappedData.posts.length === 2, cappedData.posts.length)
  check('and each network is represented once',
    new Set(cappedData.posts.map(p => p.platform)).size === 2, cappedData.posts.map(p => p.platform))

  console.log('\n=== the rendered page ===')

  const page = await text(`/tv/app/${id}`)
  check('it carries the shared wall code verbatim', page.includes(SOCIAL_WALL_JS.trim()))
  check('it declares the per-network badges', /var PLATFORM_GLYPHS = \{/.test(page))
  check('it declares the brand tints', /var PLATFORM_TINTS = \{/.test(page))
  check('the badge map covers all three networks',
    Object.keys(PLATFORM_GLYPHS).join(',') === 'instagram,facebook,twitter', Object.keys(PLATFORM_GLYPHS))
  check('X is left to inherit the text colour rather than a brand tint', !PLATFORM_TINTS.twitter)
  check('the fallback badge is nobody\'s logo', typeof MIX_GLYPH === 'string' && /viewBox/.test(MIX_GLYPH))

  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
  const css = (page.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1]
  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('no async/await', !/async function|await /.test(scripts))
  check('no arrow functions', !/=>/.test(scripts))
  check('no String.padStart', !scripts.includes('.padStart('))
  check('no Object.entries/values', !/Object\.(entries|values)\(/.test(scripts))
  check('no optional chaining or nullish coalescing', !/\?\.|\?\?/.test(scripts))
  check('no fetch — XMLHttpRequest only', !/\bfetch\(/.test(scripts))
  check('no CSS grid', !/display\s*:\s*grid/.test(css))
  check('no flex gap', !/[^-]gap\s*:/.test(css))
  check('no CSS custom properties', !/var\(--/.test(css))
  check('no inset shorthand', !/[^-]inset\s*:/.test(css))
  check('no position:sticky', !/position\s*:\s*sticky/.test(css))
  check('no aspect-ratio', !/aspect-ratio\s*:/.test(css))
  check('the page seeds itself so a screen draws immediately', scripts.includes('onPayload('))

  console.log('\n=== the single-network walls are unchanged ===')

  const igMade = await call('POST', '/api/apps/instances', {
    appId: 'instagram', name: 'IG',
    config: { source: 'feed', feedUrl: IG, displayMode: 'wall', theme: 'dark' },
  })
  const igPage = await text(`/tv/app/${igMade.body.instance.id}`)
  // The opt-in is the declaration: a wall that never declares the map keeps
  // wearing its own badge on every post, exactly as it did before.
  check('an Instagram wall declares no per-network badges', !/var PLATFORM_GLYPHS/.test(igPage))
  check('it still carries the same shared wall code', igPage.includes(SOCIAL_WALL_JS.trim()))
  const drawFns = s => (s.match(/function draw[A-Za-z]+\(/g) || []).sort().join(',')
  check('both draw through the same set of layouts',
    drawFns(page) === drawFns(igPage) && drawFns(page).length > 0, drawFns(page))
  const igData = (await call('GET', `/tv/app/${igMade.body.instance.id}/data`)).body.data
  check('and its posts carry no platform, so nothing is badged',
    igData.posts.every(p => p.platform === undefined))

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close(); upstream.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
}))
