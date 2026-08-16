// A focused iCalendar reader.
//
// Only what a calendar board actually draws: when something starts, when it
// ends, what it is called, and where. No alarms, no attendees, no free/busy.
//
// Times are treated as wall-clock on purpose. A calendar board hangs in the
// same building as the meetings it lists, and "11:00" in the calendar must read
// as "11:00" on the wall — converting through the manager's timezone is how
// boards end up an hour out after a clock change. Only explicit UTC stamps
// (trailing Z) are converted, because those carry no local meaning of their own.

export interface CalEvent {
  uid: string
  title: string
  location?: string
  /** Local wall-clock milliseconds — compare against localNow(), never Date.now(). */
  start: number
  end: number
  allDay: boolean
}

/** Unfolds the continuation lines iCalendar wraps long values onto. A folded
 *  SUMMARY silently truncates every event title if this is skipped. */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

/** Escaped text values: \n \, \; \\ all appear in real calendars. */
function unescapeText(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim()
}

/** "20261110T110000", "20261110T110000Z" or "20261127" (all-day). */
function parseStamp(value: string, isUtc: boolean): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, hh, mi, ss] = m
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(hh ?? 0), Number(mi ?? 0), Number(ss ?? 0)] as const
  // UTC stamps are converted; everything else is kept as written.
  return isUtc
    ? Date.UTC(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5])
    : new Date(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]).getTime()
}

const DAY_MS = 86_400_000
const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

/** Expands a repeating event across the window being drawn.
 *
 *  Deliberately partial: FREQ with INTERVAL, COUNT, UNTIL and BYDAY covers the
 *  weekly stand-ups and daily huddles a signage board exists to show. Anything
 *  more exotic falls back to the single first occurrence, which is wrong in a
 *  small way rather than absent in a large one. */
function expand(ev: CalEvent, rrule: string, windowStart: number, windowEnd: number): CalEvent[] {
  const rule: Record<string, string> = {}
  rrule.split(';').forEach(part => {
    const [k, v] = part.split('=')
    if (k && v) rule[k.toUpperCase()] = v
  })

  const freq = rule.FREQ
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return [ev]

  const interval = Math.max(1, Number(rule.INTERVAL ?? 1))
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity
  const until = rule.UNTIL ? (parseStamp(rule.UNTIL, /Z$/.test(rule.UNTIL)) ?? Infinity) : Infinity
  const days = rule.BYDAY ? rule.BYDAY.split(',').map(d => BYDAY[d.replace(/^[-+]?\d+/, '')]).filter(d => d !== undefined) : []

  const duration = ev.end - ev.start
  const out: CalEvent[] = []
  let emitted = 0
  const cursor = new Date(ev.start)
  // A hard ceiling so a malformed rule cannot spin: two years of daily events
  // is far more than any board window needs.
  const MAX_STEPS = 800

  for (let step = 0; step < MAX_STEPS && emitted < count; step++) {
    let occurrence: number

    if (freq === 'WEEKLY' && days.length) {
      // Walk the week's chosen days, offset from the week the series starts in.
      const weekStart = cursor.getTime() - cursor.getDay() * DAY_MS
      let placed = false
      for (const wd of days) {
        const t = weekStart + wd * DAY_MS
        if (t < ev.start) continue
        if (t > windowEnd || t > until) { placed = true; break }
        if (emitted >= count) break
        if (t + duration >= windowStart) {
          out.push({ ...ev, uid: `${ev.uid}-${t}`, start: t, end: t + duration })
        }
        emitted++
        placed = true
      }
      cursor.setDate(cursor.getDate() + 7 * interval)
      if (!placed && cursor.getTime() > windowEnd) break
      if (cursor.getTime() > windowEnd || cursor.getTime() > until) break
      continue
    }

    occurrence = cursor.getTime()
    if (occurrence > until || occurrence > windowEnd) break
    if (occurrence + duration >= windowStart) {
      out.push({ ...ev, uid: `${ev.uid}-${occurrence}`, start: occurrence, end: occurrence + duration })
    }
    emitted++

    if (freq === 'DAILY') cursor.setDate(cursor.getDate() + interval)
    else if (freq === 'WEEKLY') cursor.setDate(cursor.getDate() + 7 * interval)
    else if (freq === 'MONTHLY') cursor.setMonth(cursor.getMonth() + interval)
    else cursor.setFullYear(cursor.getFullYear() + interval)
  }

  return out
}

/** Parses an .ics feed into the events falling inside a window. */
export function parseIcs(text: string, windowStart: number, windowEnd: number): CalEvent[] {
  const lines = unfold(String(text ?? ''))
  const events: CalEvent[] = []

  let cur: Partial<CalEvent> & { rrule?: string; excluded?: number[] } | null = null

  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) { cur = { excluded: [] }; continue }
    if (!cur) continue

    if (line.startsWith('END:VEVENT')) {
      if (cur.start !== undefined && cur.title) {
        const base: CalEvent = {
          uid: cur.uid ?? String(cur.start),
          title: cur.title,
          location: cur.location,
          start: cur.start,
          // An event with no end is a point in time; give it a nominal half
          // hour so it occupies a readable row rather than a hairline.
          end: cur.end ?? cur.start + (cur.allDay ? DAY_MS : 1_800_000),
          allDay: !!cur.allDay,
        }
        const expanded = cur.rrule ? expand(base, cur.rrule, windowStart, windowEnd) : [base]
        for (const e of expanded) {
          // A cancelled occurrence of a series still ships in the feed as an
          // EXDATE; showing it would put a deleted meeting on the wall.
          if (cur.excluded?.some(x => Math.abs(x - e.start) < 60_000)) continue
          if (e.end >= windowStart && e.start <= windowEnd) events.push(e)
        }
      }
      cur = null
      continue
    }

    const colon = line.indexOf(':')
    if (colon === -1) continue
    const rawKey = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const key = rawKey.split(';')[0].toUpperCase()
    const isUtc = /Z$/.test(value.trim())
    const isDateOnly = /VALUE=DATE(?!-TIME)/i.test(rawKey)

    if (key === 'UID') cur.uid = value.trim()
    else if (key === 'SUMMARY') cur.title = unescapeText(value)
    else if (key === 'LOCATION') cur.location = unescapeText(value) || undefined
    else if (key === 'DTSTART') {
      cur.start = parseStamp(value, isUtc) ?? undefined
      if (isDateOnly) cur.allDay = true
    } else if (key === 'DTEND') {
      cur.end = parseStamp(value, isUtc) ?? undefined
    } else if (key === 'RRULE') cur.rrule = value.trim()
    else if (key === 'EXDATE') {
      value.split(',').forEach(v => {
        const t = parseStamp(v, /Z$/.test(v))
        if (t !== null) cur!.excluded!.push(t)
      })
    } else if (key === 'STATUS' && /CANCELLED/i.test(value)) {
      cur.title = undefined   // drop it entirely
    }
  }

  return events.sort((a, b) => a.start - b.start)
}
