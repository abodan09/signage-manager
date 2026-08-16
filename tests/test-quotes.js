/* Motivational Quotes: reading the operator's list, and the card a TV draws. */
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
const { parseQuotes } = require(`${DIST}/apps/quotes/index.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-q-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const q = getApp('quotes')
const san = o => sanitizeAppConfig(q, o ?? {})
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

  check('quotes is registered', !!q)
  // The words are already on this machine; a board that needed the network to
  // show them would be a poor board.
  check('it needs no network', typeof q.refresh !== 'function')
  check('it ships with something to show', !!q.fields.find(f => f.key === 'quotes').default)

  console.log('\n=== reading the list ===')

  check('one quote per line', parseQuotes('a\nb\nc').length === 3)
  check('the author comes after a bar',
    parseQuotes('Be good | Someone')[0].author === 'Someone')
  check('and the quote keeps only its own half',
    parseQuotes('Be good | Someone')[0].text === 'Be good')
  check('an author is optional', parseQuotes('Be good')[0].author === '')
  check('blank lines are skipped', parseQuotes('a\n\n\nb').length === 2)
  check('whitespace is trimmed', parseQuotes('   a   |   B   ')[0].text === 'a')
  check('and so is the author', parseQuotes('   a   |   B   ')[0].author === 'B')
  // A word processor leaves curly quotes around a pasted line; the card draws
  // its own mark, so they would appear twice.
  check('wrapping quotation marks are dropped',
    parseQuotes('“Be good” | X')[0].text === 'Be good')
  check('straight ones too', parseQuotes('"Be good" | X')[0].text === 'Be good')
  check('quotation marks inside a line are kept',
    parseQuotes('He said "no" to it')[0].text === 'He said "no" to it')
  check('a line that is only punctuation is dropped', parseQuotes('""\n“”').length === 0)
  check('nothing at all yields nothing', parseQuotes('').length === 0)
  check('a bar with no author still gives a quote',
    parseQuotes('Be good |')[0].text === 'Be good')

  console.log('\n=== saving ===')

  check('the defaults save', san().ok === true, san().error)
  check('an empty list is refused', san({ quotes: '' }).ok === false)
  check('a list of only blank lines is refused', san({ quotes: '\n\n  \n' }).ok === false)
  check('and the message says what to do',
    /one per line/i.test(san({ quotes: '   ' }).error || ''))
  check('one quote is enough', san({ quotes: 'Just the one' }).ok === true)
  check('a dwell below the floor is refused', san({ seconds: 1 }).ok === false)
  check('the scrim is bounded', san({ scrim: 500 }).ok === false)
  check('the colour fields are hidden unless the theme is custom',
    san({ theme: 'dark' }).config.backgroundColor === undefined)

  console.log('\n=== the card ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'quotes', name: 'Lobby quotes',
    config: {
      quotes: 'The time is always right to do what is right. | Martin Luther King\nSecond one | Someone',
      seconds: 10,
    },
  })
  check('an instance saves', made.status === 201, made.body)
  const page = await text(`/tv/app/${made.body.instance.id}`)
  const scripts = scriptsOf(page)

  check('the quotes reach the page', page.includes('The time is always right'))
  check('so does the attribution', page.includes('Martin Luther King'))
  const list = JSON.parse(/var QUOTES = (\[[\s\S]*?\]);/.exec(scripts)[1])
  check('both are carried', list.length === 2)
  check('split into words and name', list[0].author === 'Martin Luther King')
  // The serif is bundled and served by the manager: a TV has almost no fonts of
  // its own and would silently substitute one.
  check('the typeface is the bundled serif', page.includes('Playfair Display'))
  check('and its @font-face is served', page.includes('/fonts/'))

  // Sizing by measurement, not by guessing from length — the lesson the clock
  // board taught: a fourteen-word quote and a four-word one need very
  // different sizes and only the box knows when it has run out.
  check('the text is fitted by measuring it',
    /scrollWidth/.test(scripts) && /offsetHeight/.test(scripts))
  // The height must come from the inner box: the card is a centring flex
  // container and always reports its own height, so a loop driven by the card
  // never sees the text fit and shrinks it away to nothing.
  // The floor must bound the size, not decide whether a size is applied: with
  // the assignments inside a guarded while, a page in a short Split Screen zone
  // got no size at all and fell back to the browser's 16px — larger than the
  // box it was shrinking to fit.
  check('a size is always applied, even in a box too short to shrink into',
    /var size = Math.max\(10, boxH \* 0.2\)/.test(scripts) && /for \(;;\)/.test(scripts))
  check('and the floor only stops the shrinking', /size <= 10 \|\| guard/.test(scripts))
  // One unbreakable token would otherwise drag the whole quote to the floor
  // and still overflow, because max-width caps the box it is measured against.
  check('a long unbroken word wraps rather than shrinking everything',
    /overflow-wrap:break-word/.test(page))
  check('and the height is measured on the inner box, not the card',
    /inner\.offsetHeight/.test(scripts) && !/card\.scrollHeight/.test(scripts))
  check('and refitted when the screen changes shape', /addEventListener\('resize'/.test(scripts))

  let parses = true
  try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
  check('the page parses', parses)
  check('it is ES5',
    !/=>|async function|await |\.padStart\(|\?\?|\?\.|Object\.(entries|values)\(/.test(scripts))
  check('it never fetches from the TV', !/\bfetch\(/.test(scripts))
  check('no CSS grid', !/display\s*:\s*grid/.test(page))
  check('no flex gap', !/[^-]gap\s*:/.test(page))
  check('no CSS custom properties', !page.includes('var(--'))
  check('no inset shorthand', !/[^-]inset\s*:/.test(page))
  check('the change is a fade, never a transform', !/[^-]transform\s*:/.test(page))
  check('it never reports itself finished', !/signage:ended/.test(page))

  console.log('\n=== one quote is a poster, not a rotation ===')

  const single = await call('POST', '/api/apps/instances', {
    appId: 'quotes', name: 'One', config: { quotes: 'Only this one' },
  })
  const singlePage = await text(`/tv/app/${single.body.instance.id}`)
  // Fading a single quote out and back into itself every few seconds would
  // look like a fault.
  check('a lone quote is not cycled',
    /QUOTES.length > 1/.test(scriptsOf(singlePage)))
  check('and its rule and name are hidden when there is no author',
    /authorEl.className = q.author/.test(scriptsOf(singlePage)))

  console.log('\n=== background picture ===')

  const withBg = await call('POST', '/api/apps/instances', {
    appId: 'quotes', name: 'Photo',
    config: { quotes: 'A quote', backgroundImage: '/uploads/pic.jpg', scrim: 60 },
  })
  const bgPage = await text(`/tv/app/${withBg.body.instance.id}`)
  check('the picture is used', bgPage.includes('/uploads/pic.jpg'))
  // Relative, so it resolves against whatever address the screen used to reach
  // this manager rather than the one this PC believes it has.
  check('and referenced relatively', !/url\("https?:/.test(bgPage))
  check('the scrim is applied', bgPage.includes('opacity:0.6'))
  // Darkening only ever helps light words. A light theme puts dark words on
  // the picture, so the same slider has to fade towards white instead.
  check('a dark theme fades the picture towards black',
    /#scrim\{[^}]*background:#000000/.test(bgPage))
  const lightBg = await call('POST', '/api/apps/instances', {
    appId: 'quotes', name: 'Light photo',
    config: { quotes: 'A quote', backgroundImage: '/uploads/pic.jpg', scrim: 60, theme: 'light' },
  })
  const lightPage = await text(`/tv/app/${lightBg.body.instance.id}`)
  check('and a light theme fades it towards white',
    /#scrim\{[^}]*background:#ffffff/.test(lightPage))
  const noBg = await text(`/tv/app/${single.body.instance.id}`)
  check('no picture means no scrim layer at all', !noBg.includes('id="scrim"'))

  console.log('\n=== safety ===')

  const nasty = await call('POST', '/api/apps/instances', {
    appId: 'quotes', name: 'X',
    config: { quotes: '<img src=x onerror=alert(1)> | </script><script>alert(2)</script>' },
  })
  const nastyPage = await text(`/tv/app/${nasty.body.instance.id}`)
  check('a hostile quote cannot inject markup', !/<img src=x onerror/.test(nastyPage))
  // appPage escapes the title itself, so escaping it here too emitted doubled
  // entities for any punctuation an operator naturally types.
  const amp = await call('POST', '/api/apps/instances', {
    appId: 'quotes', name: 'Tea & Coffee', config: { quotes: 'A quote' },
  })
  const ampPage = await text(`/tv/app/${amp.body.instance.id}`)
  check('the page title is escaped once, not twice',
    /<title>[^<]*Tea &amp; Coffee<\/title>/.test(ampPage) && !/&amp;amp;/.test(ampPage))
  check('and cannot close the script block',
    !/<\/script><script>alert/.test(nastyPage))
  check('no inline event handlers are emitted',
    !/<[a-z][^>]*\son[a-z]+\s*=/i.test(nastyPage))
  // The path goes straight into a CSS url(), so it is whitelisted at the door
  // rather than escaped on the way out: /uploads/ plus word characters only,
  // which leaves no quote, bracket or colon to break out with.
  const nastyImg = await call('POST', '/api/apps/instances', {
    appId: 'quotes', name: 'Y',
    config: { quotes: 'A', backgroundImage: 'x");background:url("javascript:alert(1)' },
  })
  check('a hostile picture path is refused at save time', nastyImg.status === 400, nastyImg.body)
  const remoteImg = await call('POST', '/api/apps/instances', {
    appId: 'quotes', name: 'Z',
    config: { quotes: 'A', backgroundImage: 'https://elsewhere.example/p.jpg' },
  })
  // A picture from somewhere else vanishes the moment the screen loses its WAN.
  check('and so is a picture hosted somewhere else', remoteImg.status === 400)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
