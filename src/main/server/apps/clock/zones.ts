// Timezone handling for the clock apps.
//
// A clock on a wall that is an hour wrong for half the year is worse than no
// clock, so a fixed UTC offset is not good enough. But the TV browsers this
// product supports cannot be trusted to carry full ICU data, so asking the
// page to resolve "America/New_York" itself is not safe either.
//
// Instead the manager — which has full ICU — works out when the offset changes
// and ships a small schedule with the page. The page then holds the correct
// time offline, through DST changes, for as long as the schedule runs.

export interface ZoneShift {
  /** UTC ms from which `offset` applies. */
  from: number
  /** Seconds east of UTC. */
  offset: number
}

/** The chosen zone's offset now, plus every change over the coming window.
 *  Scanned a day at a time: transitions land on a Sunday somewhere in the
 *  small hours, so daily resolution finds them, and the exact instant is then
 *  bisected to the minute. */
export function zoneSchedule(timeZone: string, months = 18): ZoneShift[] {
  const offsetAt = (t: number) => offsetSeconds(timeZone, t)

  const start = Date.now()
  const end = start + months * 30 * 86_400_000
  const shifts: ZoneShift[] = [{ from: 0, offset: offsetAt(start) }]

  let prev = shifts[0].offset
  for (let t = start; t < end; t += 86_400_000) {
    const next = offsetAt(t)
    if (next === prev) continue
    // Narrow the day down to the minute the change actually happens, so a
    // clock is never up to 24 hours wrong around a transition.
    let lo = t - 86_400_000
    let hi = t
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 2)
      if (offsetAt(mid) === prev) lo = mid
      else hi = mid
    }
    shifts.push({ from: hi, offset: next })
    prev = next
  }
  return shifts
}

/** Seconds east of UTC for a zone at an instant. Uses the formatted local
 *  time rather than a table, so it is correct for any zone Node knows. */
export function offsetSeconds(timeZone: string, at: number): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const parts: Record<string, string> = {}
    for (const p of fmt.formatToParts(new Date(at))) parts[p.type] = p.value
    // Hour 24 appears at midnight in some locales; normalise it to 0.
    const hour = parts.hour === '24' ? '00' : parts.hour
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(hour), Number(parts.minute), Number(parts.second),
    )
    // Rounded to the minute: `at` carries milliseconds that the formatted
    // string does not, and the remainder would otherwise leak in as a stray
    // second — turning UTC-5 into -18001 and a half-hour zone into 5.4997.
    return Math.round((asUtc - at) / 60_000) * 60
  } catch {
    return 0   // unknown zone — UTC is a defensible fallback
  }
}

export function isKnownZone(timeZone: string): boolean {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

/** The zones an operator actually picks, kept short enough to scan. Anything
 *  else can be typed in, and is validated against ICU. */
export const COMMON_ZONES: Array<{ value: string; label: string }> = [
  { value: '', label: 'This screen’s own time' },
  { value: 'Pacific/Auckland', label: 'Auckland' },
  { value: 'Australia/Sydney', label: 'Sydney' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
  { value: 'Asia/Shanghai', label: 'Shanghai' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { value: 'Asia/Kolkata', label: 'Mumbai / Delhi' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Europe/Moscow', label: 'Moscow' },
  { value: 'Africa/Nairobi', label: 'Nairobi' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg' },
  { value: 'Europe/Athens', label: 'Athens' },
  { value: 'Africa/Cairo', label: 'Cairo' },
  { value: 'Europe/Rome', label: 'Rome' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Europe/Madrid', label: 'Madrid' },
  { value: 'Africa/Lagos', label: 'Lagos' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Lisbon', label: 'Lisbon' },
  { value: 'America/Sao_Paulo', label: 'São Paulo' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'America/Toronto', label: 'Toronto' },
  { value: 'America/Chicago', label: 'Chicago' },
  { value: 'America/Mexico_City', label: 'Mexico City' },
  { value: 'America/Denver', label: 'Denver' },
  { value: 'America/Los_Angeles', label: 'Los Angeles' },
  { value: 'America/Anchorage', label: 'Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Honolulu' },
  { value: 'UTC', label: 'UTC' },
]
