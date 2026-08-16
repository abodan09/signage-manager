/* Countdown and Count-up: the shared board, the new datetime field, and the
   recurrence arithmetic — which is exercised against the real shipped page code
   rather than a copy of it. */
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-t-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)
const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

const down = getApp('countdown')
const up = getApp('countup')
const scriptsOf = html =>
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')

const pageFor = (defn, config) => defn.render({
  instance: { id: 'i', appId: defn.id, name: 'T', config },
  data: null, fontCss: '', baseUrl: '',
})

/** Lifts the two date functions out of the page this app actually ships and
 *  runs them here, so the recurrence maths is tested as emitted rather than as
 *  a second copy that could drift from it. */
function dateFnsFrom(page, cfg) {
  const src = scriptsOf(page)
  const grab = name => {
    const i = src.indexOf(`function ${name}(`)
    if (i < 0) throw new Error(`${name} missing from the page`)
    let depth = 0, j = src.indexOf('{', i)
    for (let k = j; k < src.length; k++) {
      if (src[k] === '{') depth++
      else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1) }
    }
    throw new Error(`${name} not closed`)
  }
  const fn = new Function('CFG',
    `${grab('momentAtRaw')}\n${grab('occurrenceOf')}\n` +
    'return { momentAtRaw: momentAtRaw, occurrenceOf: occurrenceOf }')
  return fn(cfg)
}

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

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

  check('countdown is registered', !!down)
  check('count-up is registered', !!up)
  check('neither needs a network',
    typeof down.refresh !== 'function' && typeof up.refresh !== 'function')
  // One implementation, two directions — the same reasoning as Drive/OneDrive
  // and Simple Clock/World Clock.
  check('they are the same board',
    scriptsOf(pageFor(down, { endAt: '2027-01-01T00:00' })).includes('function occurrenceOf') &&
    scriptsOf(pageFor(up, { startAt: '2026-01-01T00:00' })).includes('function occurrenceOf'))
  check('and they say which way they count',
    pageFor(down, { endAt: '2027-01-01T00:00' }).includes('"kind":"down"') &&
    pageFor(up, { startAt: '2026-01-01T00:00' }).includes('"kind":"up"'))

  console.log('\n=== the date and time field ===')

  const sanD = o => sanitizeAppConfig(down, { endAt: '2027-01-01T00:00', ...o })
  check('a date and time saves', sanD().ok === true, sanD().error)
  check('the moment is required', sanD({ endAt: '' }).ok === false)
  // The generic required message names the field, which is enough; the app's
  // own validate() is belt-and-braces for a config that never went through the
  // form at all.
  check('and the message names the field',
    /required/i.test(sanD({ endAt: '' }).error || '') &&
    /counts down to/i.test(sanD({ endAt: '' }).error || ''), sanD({ endAt: '' }).error)
  check('rubbish is refused', sanD({ endAt: 'next tuesday' }).ok === false)
  check('a date with no time is refused', sanD({ endAt: '2027-01-01' }).ok === false)
  // The Date constructor rolls 31 February over to 3 March rather than
  // refusing, so the only way to catch it is to read the date back.
  check('31 February is refused', sanD({ endAt: '2027-02-31T10:00' }).ok === false)
  check('and 30 February in a leap year too', sanD({ endAt: '2028-02-30T10:00' }).ok === false)
  check('29 February in a leap year is fine', sanD({ endAt: '2028-02-29T10:00' }).ok === true)
  check('seconds are trimmed off',
    sanD({ endAt: '2027-01-01T10:30:45' }).config.endAt === '2027-01-01T10:30')

  console.log('\n=== counting once ===')

  const once = dateFnsFrom(pageFor(down, { endAt: '2027-03-01T18:00' }), { repeatDays: 0, kind: 'down' })
  check('a moment is read as local wall-clock time',
    once.momentAtRaw('2027-03-01T18:00') === at(2027, 3, 1, 18, 0))
  // An ISO string with no zone was read as UTC by some old browsers and as
  // local by others; building it from the parts removes the question.
  check('and it does not drift with the machine\'s zone',
    new Date(once.momentAtRaw('2027-03-01T18:00')).getHours() === 18)
  check('a non-repeating moment is itself',
    once.occurrenceOf(at(2027, 3, 1, 18, 0), at(2026, 1, 1, 0, 0)) === at(2027, 3, 1, 18, 0))

  console.log('\n=== counting again, and again ===')

  const daily = { repeatDays: 1, kind: 'up', repeatUntil: '' }
  const upFns = dateFnsFrom(pageFor(up, { startAt: '2026-01-01T18:00', repeat: 'days' }), daily)
  const baseAt = at(2026, 1, 1, 18, 0)

  const nowMid = at(2026, 3, 15, 20, 30)
  const occUp = upFns.occurrenceOf(baseAt, nowMid)
  check('counting up uses the most recent occurrence', occUp === at(2026, 3, 15, 18, 0),
    new Date(occUp).toString())
  check('and never one in the future', occUp <= nowMid)

  const beforeStart = at(2026, 3, 15, 17, 30)
  const occEarly = upFns.occurrenceOf(baseAt, beforeStart)
  check('before today\'s occurrence it uses yesterday\'s',
    occEarly === at(2026, 3, 14, 18, 0), new Date(occEarly).toString())

  const downFns = dateFnsFrom(
    pageFor(down, { endAt: '2026-01-01T18:00', repeat: 'days' }),
    { repeatDays: 1, kind: 'down', repeatUntil: '' })
  const occDown = downFns.occurrenceOf(baseAt, nowMid)
  check('counting down uses the next occurrence', occDown === at(2026, 3, 16, 18, 0),
    new Date(occDown).toString())
  check('and never one in the past', occDown > nowMid)

  // The whole reason the step is setDate and not a fixed number of
  // milliseconds: a day is not always 86,400,000 ms, and adding them across a
  // clock change slides a daily happy hour by an hour for half the year.
  const farOff = upFns.occurrenceOf(baseAt, at(2026, 8, 20, 20, 0))
  check('the hour survives a span that crosses a clock change',
    new Date(farOff).getHours() === 18, new Date(farOff).toString())
  const farDown = downFns.occurrenceOf(baseAt, at(2026, 11, 20, 20, 0))
  check('in both directions', new Date(farDown).getHours() === 18, new Date(farDown).toString())

  const weekly = dateFnsFrom(pageFor(up, { startAt: '2026-01-05T09:00', repeat: 'weeks' }),
    { repeatDays: 7, kind: 'up', repeatUntil: '' })
  const occWeek = weekly.occurrenceOf(at(2026, 1, 5, 9, 0), at(2026, 2, 10, 12, 0))
  check('a weekly repeat lands on the same weekday',
    new Date(occWeek).getDay() === new Date(at(2026, 1, 5, 9, 0)).getDay(),
    new Date(occWeek).toString())

  const ending = dateFnsFrom(
    pageFor(up, { startAt: '2026-01-01T18:00', repeat: 'days', repeatUntil: '2026-01-10T00:00' }),
    { repeatDays: 1, kind: 'up', repeatUntil: '2026-01-10T00:00' })
  const held = ending.occurrenceOf(baseAt, at(2026, 6, 1, 12, 0))
  check('a repeat that has ended holds on its last occurrence',
    held <= at(2026, 1, 10, 0, 0), new Date(held).toString())

  console.log('\n=== the board ===')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'countdown', name: 'Launch',
    config: { heading: 'Count down to launch', endAt: '2027-01-14T10:00', message: 'Here we go!' },
  })
  check('an instance saves', made.status === 201, made.body)
  const page = await text(`/tv/app/${made.body.instance.id}`)

  check('the heading reaches the page', page.includes('Count down to launch'))
  check('so does the message for zero', page.includes('Here we go!'))
  check('the tiles carry a seam, so they read as a flip clock', page.includes('class="seam"'))
  // A countdown sitting on 00:00:00:00 for ever looks broken, not finished.
  check('reaching zero swaps the numbers for the message',
    /doneEl.className = 'on'/.test(scriptsOf(page)))
  // Counting up from a moment that has not arrived would otherwise show
  // negative numbers, which is what a mistyped year produces.
  check('counting up before its moment holds at zero',
    /diff = 0/.test(scriptsOf(pageFor(up, { startAt: '2030-01-01T00:00' }))))

  const daysOnly = pageFor(down, { endAt: '2027-01-14T10:00', units: 'days' })
  check('days only carries one group', daysOnly.includes('"daysOnly":true'))
  const hoursOnly = pageFor(down, { endAt: '2027-01-14T10:00', units: 'hours' })
  check('hiding days rolls them into the hours',
    /p.d \* 24 \+ p.h/.test(scriptsOf(hoursOnly)))

  console.log('\n=== the page a TV gets ===')

  const scripts = scriptsOf(page)
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
  check('no compositor transform', !/[^-]transform\s*:/.test(page))
  check('it never reports itself finished', !/signage:ended/.test(page))
  // The board has to sit on a portrait lift panel and a 4K totem.
  check('the tiles are sized from the box they are given',
    /clientWidth/.test(scripts) && /clientHeight/.test(scripts))
  check('and resized when the screen changes shape', /addEventListener\('resize'/.test(scripts))

  const nasty = await call('POST', '/api/apps/instances', {
    appId: 'countdown', name: 'X',
    config: {
      heading: '<img src=x onerror=alert(1)>', endAt: '2027-01-14T10:00',
      message: '</script><script>alert(2)</script>',
    },
  })
  const nastyPage = await text(`/tv/app/${nasty.body.instance.id}`)
  check('a hostile heading cannot inject markup', !/<img src=x onerror/.test(nastyPage))
  check('and a hostile message cannot close the script block',
    !/<\/script><script>alert/.test(nastyPage))

  console.log('\n=== picture behind it ===')

  const withBg = await call('POST', '/api/apps/instances', {
    appId: 'countup', name: 'Happy hour',
    config: {
      heading: 'Happy hour in progress', startAt: '2026-01-01T17:00',
      repeat: 'days', repeatEvery: 1,
      backgroundImage: '/uploads/bar.jpg', scrim: 40, tileOpacity: 75,
    },
  })
  check('a repeating count-up over a picture saves', withBg.status === 201, withBg.body)
  const bgPage = await text(`/tv/app/${withBg.body.instance.id}`)
  check('the picture is used', bgPage.includes('/uploads/bar.jpg'))
  check('the repeat reaches the page', bgPage.includes('"repeatDays":1'))
  check('and the tiles can be seen through', bgPage.includes('opacity:0.75'))
  check('a picture from elsewhere is refused',
    (await call('POST', '/api/apps/instances', {
      appId: 'countup', name: 'Y',
      config: { startAt: '2026-01-01T17:00', backgroundImage: 'https://x.example/p.jpg' },
    })).status === 400)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
})
