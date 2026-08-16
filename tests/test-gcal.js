/* Google Calendar: the iCal reader (where the bugs live), source parsing, and
   the three drawn views. */
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
const { parseIcs } = require(`${DIST}/apps/gcal/ics.js`)
const { parseCalendarSource } = require(`${DIST}/apps/gcal/index.js`)
const { createAppsRouter } = require(`${DIST}/routes/apps.js`)
const { createSceneRouter } = require(`${DIST}/routes/scene.js`)
const { PackStore } = require(`${DIST}/packs.js`)

let pass = 0, fail = 0
const check = (n, c, extra) => {
  if (c) { pass++; console.log(`  PASS  ${n}`) }
  else { fail++; console.log(`  FAIL  ${n}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-gcal-'))
const db = new JsonDB(dir)
const assetsDir = path.join(ROOT, 'assets')
const apps = new AppStore(db, dir, assetsDir)
const packs = new PackStore(dir, assetsDir, db)

const WIDE_FROM = Date.UTC(2020, 0, 1)
const WIDE_TO = Date.UTC(2030, 0, 1)

// A year that is safely inside the window, expressed as local wall-clock.
const ics = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`

const app = express()
app.use(express.json())
const lanUrl = () => `http://127.0.0.1:${server.address().port}`
app.use('/api/apps', createAppsRouter(db, apps, new Map(), lanUrl))
app.use('/tv', createSceneRouter(db, packs, path.join(assetsDir, 'fonts'), apps, lanUrl))

let feedBody = ''
let feedStatus = 200
const upstream = http.createServer((req, res) => {
  res.writeHead(feedStatus, { 'content-type': 'text/calendar' })
  res.end(feedBody)
})

const server = app.listen(0, () => upstream.listen(0, async () => {
  const base = lanUrl()
  const FEED = `http://127.0.0.1:${upstream.address().port}/basic.ics`
  const call = async (m, u, b) => {
    const res = await fetch(base + u, {
      method: m, headers: b ? { 'content-type': 'application/json' } : {},
      body: b ? JSON.stringify(b) : undefined,
    })
    let json = null; try { json = await res.json() } catch {}
    return { status: res.status, body: json }
  }
  const text = async u => (await fetch(base + u)).text()

  console.log('\n=== the iCal reader ===')

  const one = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:a1\r\nDTSTART:20260610T110000\r\nDTEND:20260610T120000\r\n' +
    'SUMMARY:Team Meeting\r\nLOCATION:Room 3\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  check('a plain event is read', one.length === 1 && one[0].title === 'Team Meeting', one)
  check('its location comes through', one[0]?.location === 'Room 3')
  // Wall-clock, deliberately: 11:00 in the calendar must be 11:00 on the wall.
  check('the time is kept as written, not shifted by a timezone',
    new Date(one[0].start).getHours() === 11, new Date(one[0]?.start).toString())

  const folded = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:a2\r\nDTSTART:20260610T090000\r\nDTEND:20260610T100000\r\n' +
    'SUMMARY:A very long event title that Google will\r\n  wrap onto a second line\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  // Folded lines are the classic iCal trap: skip unfolding and every long
  // title silently truncates.
  check('a folded title is rejoined',
    folded[0]?.title === 'A very long event title that Google will wrap onto a second line', folded[0]?.title)

  const escaped = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:a3\r\nDTSTART:20260610T090000\r\nSUMMARY:Lunch\\, then review\\; room B\r\nEND:VEVENT'),
    WIDE_FROM, WIDE_TO)
  check('escaped commas and semicolons are unescaped',
    escaped[0]?.title === 'Lunch, then review; room B', escaped[0]?.title)

  const allDay = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:a4\r\nDTSTART;VALUE=DATE:20261127\r\nDTEND;VALUE=DATE:20261128\r\n' +
    'SUMMARY:Thanksgiving Day\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  check('an all-day event is flagged as such', allDay[0]?.allDay === true)

  const tz = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:a5\r\nDTSTART;TZID=Europe/Vienna:20260610T143000\r\n' +
    'DTEND;TZID=Europe/Vienna:20260610T153000\r\nSUMMARY:Strategy Review\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  check('a TZID event keeps its stated hour', new Date(tz[0].start).getHours() === 14)

  const noEnd = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:a6\r\nDTSTART:20260610T160000\r\nSUMMARY:Drop in\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  check('an event with no end still occupies a readable slot',
    noEnd[0] && noEnd[0].end > noEnd[0].start, noEnd[0])

  const cancelled = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:a7\r\nDTSTART:20260610T110000\r\nSUMMARY:Cancelled thing\r\nSTATUS:CANCELLED\r\nEND:VEVENT'),
    WIDE_FROM, WIDE_TO)
  check('a cancelled event is dropped', cancelled.length === 0)

  console.log('\n--- recurrence ---')

  const weekly = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:r1\r\nDTSTART:20260601T110000\r\nDTEND:20260601T120000\r\n' +
    'SUMMARY:Standup\r\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  check('a weekly series expands', weekly.length === 4, weekly.length)
  check('every occurrence keeps the title', weekly.every(e => e.title === 'Standup'))
  check('occurrences are a week apart',
    weekly.length > 1 && Math.round((weekly[1].start - weekly[0].start) / 86400000) === 7)
  check('each occurrence gets its own id', new Set(weekly.map(e => e.uid)).size === weekly.length)

  const daily = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:r2\r\nDTSTART:20260601T090000\r\nDTEND:20260601T093000\r\n' +
    'SUMMARY:Huddle\r\nRRULE:FREQ=DAILY;COUNT=5\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  check('a daily series expands', daily.length === 5, daily.length)

  const until = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:r3\r\nDTSTART:20260601T090000\r\nSUMMARY:Ends\r\n' +
    'RRULE:FREQ=DAILY;UNTIL=20260605T000000Z\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  check('UNTIL stops the series', until.length > 0 && until.length <= 5, until.length)

  const exdate = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:r4\r\nDTSTART:20260601T110000\r\nDTEND:20260601T120000\r\n' +
    'SUMMARY:Standup\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20260602T110000\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  // A deleted occurrence still ships in the feed; showing it puts a meeting
  // that is not happening on the wall.
  check('a cancelled occurrence is skipped', exdate.length === 2, exdate.length)

  const unbounded = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:r5\r\nDTSTART:20260101T090000\r\nSUMMARY:Forever\r\n' +
    'RRULE:FREQ=DAILY\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
  check('an endless rule terminates rather than spinning', unbounded.length > 0 && unbounded.length <= 800,
    unbounded.length)

  const windowed = parseIcs(ics(
    'BEGIN:VEVENT\r\nUID:w1\r\nDTSTART:20200101T090000\r\nSUMMARY:Ancient\r\nEND:VEVENT'),
    Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31))
  check('events outside the window are dropped', windowed.length === 0)

  check('junk parses to nothing rather than throwing', parseIcs('not a calendar', WIDE_FROM, WIDE_TO).length === 0)
  check('an empty feed is fine', parseIcs('', WIDE_FROM, WIDE_TO).length === 0)
  check('events come back in time order', (() => {
    const r = parseIcs(ics(
      'BEGIN:VEVENT\r\nUID:s2\r\nDTSTART:20260610T150000\r\nSUMMARY:Later\r\nEND:VEVENT\r\n' +
      'BEGIN:VEVENT\r\nUID:s1\r\nDTSTART:20260610T090000\r\nSUMMARY:Earlier\r\nEND:VEVENT'), WIDE_FROM, WIDE_TO)
    return r[0]?.title === 'Earlier'
  })())

  console.log('\n=== the calendar address ===')

  check('a secret iCal URL is accepted',
    parseCalendarSource('https://calendar.google.com/calendar/ical/abc/private-xyz/basic.ics') !== null)
  check('webcal:// becomes https://',
    parseCalendarSource('webcal://example.com/feed.ics')?.indexOf('https://') === 0)
  check('a bare calendar id becomes a public feed URL',
    /calendar\.google\.com.*basic\.ics/.test(parseCalendarSource('team@group.calendar.google.com') ?? ''))
  check('a random web page is refused', parseCalendarSource('https://example.com/index.html') === null)
  check('empty input is refused', parseCalendarSource('') === null)

  console.log('\n=== fetching and drawing ===')

  const gc = getApp('gcal')
  check('gcal is registered', !!gc)
  const badCfg = sanitizeAppConfig(gc, { source: 'https://example.com/nope.html' })
  check('a bad address is rejected with the menu path',
    badCfg.ok === false && /Integrate calendar/.test(badCfg.error ?? ''), badCfg.error)

  const now = new Date()
  const soon = new Date(now.getTime() + 3600e3)
  const stamp = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
    + 'T' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '00'
  feedBody = ics(
    `BEGIN:VEVENT\r\nUID:live1\r\nDTSTART:${stamp(now)}\r\nDTEND:${stamp(soon)}\r\n` +
    'SUMMARY:Team Meeting\r\nLOCATION:Room 3\r\nEND:VEVENT')

  const made = await call('POST', '/api/apps/instances', {
    appId: 'gcal', name: 'Lobby calendar',
    config: { source: FEED, view: 'agenda', title: 'MY CALENDAR', theme: 'light' },
  })
  check('an instance is created and fetches', made.status === 201 && !made.body.instance.lastError,
    made.body?.instance?.lastError)
  const id = made.body.instance.id

  const data = (await call('GET', `/tv/app/${id}/data`)).body.data
  check('the event reaches the screen payload', data.events.length === 1 && data.events[0].title === 'Team Meeting')

  for (const view of ['agenda', 'month', 'today']) {
    await call('PUT', `/api/apps/instances/${id}`, {
      config: { source: FEED, view, title: 'MY CALENDAR', theme: 'light' },
    })
    const page = await text(`/tv/app/${id}`)
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
    const css = (page.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
    let parses = true
    try { new Function(scripts) } catch (e) { parses = false; console.log('   ', e.message) }
    check(`${view}: the page parses`, parses)
    check(`${view}: it is ES5`, !/=>|async function|\.padStart\(|\?\?|\?\./.test(scripts))
    check(`${view}: no CSS grid or flex gap`, !/display\s*:\s*grid/.test(css) && !/[^-]gap\s*:/.test(css))
    check(`${view}: the heading is drawn`, page.includes('MY CALENDAR'))
    check(`${view}: it seeds itself so a screen draws at once`, page.includes('var SEED = {'))
  }

  // The icon set is only carried when a weather app is actually referenced.
  const noWx = await text(`/tv/app/${id}`)
  check('no weather icons are shipped when weather is off', noWx.includes('var ICONS = {}'))

  feedStatus = 404
  const gone = await call('POST', `/api/apps/instances/${id}/refresh`)
  check('a missing calendar is reported clearly',
    gone.status === 502 && /not found/i.test(JSON.stringify(gone.body)), gone.body)
  const still = await call('GET', `/tv/app/${id}/data`)
  check('the last known schedule stays on screen', still.body.data.events.length === 1)
  feedStatus = 200

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
  server.close(); upstream.close()
  setTimeout(() => process.exit(fail ? 1 : 0), 1500).unref()
}))
