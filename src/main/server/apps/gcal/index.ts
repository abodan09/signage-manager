import type { AppContext, AppDefinition, AppRefreshResult } from '../types'
import { appPage, escapeHtml, jsonLiteral, resolveTheme } from '../render'
import { parseIcs, type CalEvent } from './ics'
import { GCAL_CSS, GCAL_JS } from './views'
import { allIcons } from '../weather/icons'

// Google Calendar.
//
// This one does NOT embed. Google's own embed is a web calendar — small type,
// dense month grid, built for a mouse — and it reads badly from across a room.
// So the manager fetches the calendar and the app draws it, which also means
// the board keeps its last known schedule when the network drops.
//
// The zero-setup route is the calendar's iCal address. Google publishes one
// per calendar (Settings → Integrate calendar → Secret address in iCal
// format), it needs no OAuth, no Cloud project and no consent screen, and it
// works the moment it is pasted. Google's OAuth does support loopback and
// PKCE, so a native sign-in is possible later; it would still need a verified
// Cloud project, which the iCal address sidesteps entirely.

const MAX_EVENTS = 400

/** Accepts the iCal address, or a calendar id, and returns a fetchable URL. */
export function parseCalendarSource(input: string): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null

  if (/^https?:\/\//i.test(raw)) {
    if (!/\.ics(\?|$)/i.test(raw) && !/\/ical\//i.test(raw) && !/calendar\.google\.com/i.test(raw)) return null
    // webcal:// is the same document over https; browsers and calendars use it
    // interchangeably and operators paste both.
    return raw.replace(/^webcal:/i, 'https:')
  }
  if (/^webcal:\/\//i.test(raw)) return raw.replace(/^webcal:/i, 'https:')

  // A bare calendar id — the public feed for it, which works when the calendar
  // itself is public.
  if (/^[^\s/]+@[^\s/]+$/.test(raw) || /^[a-z0-9_-]+@group\.calendar\.google\.com$/i.test(raw)) {
    return `https://calendar.google.com/calendar/ical/${encodeURIComponent(raw)}/public/basic.ics`
  }
  return null
}

export const gcal: AppDefinition = {
  id: 'gcal',
  name: 'Google Calendar',
  icon: '📅',
  description: 'Show what is on today, this week or this month, drawn to be read across a room.',
  category: 'productivity',
  defaultDuration: 45,

  fields: [
    {
      key: 'howto', label: 'Use the calendar’s iCal address', type: 'note',
      help: 'In Google Calendar: Settings → pick the calendar → Integrate calendar → copy the "Secret address in iCal format". '
        + 'That needs no sign-in, so a screen can read it. Treat it like a password — anyone with the address can read the calendar.',
    },
    {
      key: 'source', label: 'iCal address', type: 'text', required: true, maxLength: 600,
      placeholder: 'https://calendar.google.com/calendar/ical/…/private-…/basic.ics',
      help: 'The secret iCal address, a public .ics link, or a calendar id.',
    },
    {
      key: 'view', label: 'View', type: 'select', required: true, default: 'agenda',
      options: [
        { value: 'agenda', label: 'Week agenda', hint: 'Day by day with times — what the room needs to know' },
        { value: 'month', label: 'Month at a glance', hint: 'A whole month, with all-day events marked' },
        { value: 'today', label: 'Today only', hint: 'Just today’s schedule, in larger type' },
      ],
    },
    {
      key: 'title', label: 'Heading', type: 'text', default: 'My Calendar', maxLength: 60,
      help: 'Shown on the side panel.',
    },
    {
      key: 'theme', label: 'Theme', type: 'select', required: true, default: 'light',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'custom', label: 'Custom' },
      ],
    },
    {
      key: 'backgroundColor', label: 'Background Colour', type: 'color', default: '#ffffff',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'textColor', label: 'Text Colour', type: 'color', default: '#1f2937',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'photo', label: 'Side panel picture', type: 'image',
      help: 'Optional. The clock and date sit over it; without one the panel is a plain colour.',
    },

    // ── Advanced ──
    {
      key: 'weatherAppId', label: 'Show weather from', type: 'text', maxLength: 60, advanced: true,
      help: 'Paste the id of a Weather app to show a forecast beside each day. Leave empty for no weather.',
    },
    {
      key: 'clockFormat', label: 'Clock', type: 'select', default: '12h', advanced: true,
      options: [
        { value: '12h', label: '12 hour (8:55 AM)' },
        { value: '24h', label: '24 hour (08:55)' },
      ],
    },
    {
      key: 'hideDeclined', label: 'Hide all-day events', type: 'checkbox', default: false, advanced: true,
      help: 'Birthdays and public holidays can crowd out the meetings people are looking for.',
    },
    {
      key: 'maxPerDay', label: 'Most events per day', type: 'number', default: 6, min: 1, max: 20, advanced: true,
      help: 'A busy day is truncated with a count, rather than overflowing the row.',
    },
  ],

  validate(config) {
    if (!parseCalendarSource(String(config.source ?? ''))) {
      return 'That is not a calendar address. In Google Calendar use Settings → Integrate calendar → Secret address in iCal format.'
    }
    return null
  },

  async refresh(ctx: AppContext): Promise<AppRefreshResult> {
    const url = parseCalendarSource(String(ctx.instance.config.source ?? ''))
    if (!url) throw new Error('That calendar address could not be read.')

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 25_000)
    let text: string
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SignageManager/1.0' } })
      if (res.status === 404) throw new Error('That calendar was not found. Check the address, or re-copy it from Google.')
      if (res.status === 401 || res.status === 403) {
        throw new Error('That calendar is private. Use the secret iCal address, or make the calendar public.')
      }
      if (!res.ok) throw new Error(`The calendar service returned ${res.status}`)
      text = await res.text()
    } finally {
      clearTimeout(timer)
    }

    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error('That address did not return a calendar. Make sure it is the iCal (.ics) link.')
    }

    // A generous window either side of today: the month view needs the weeks
    // that bleed in from the months on either side, and the agenda needs to
    // survive being looked at just before midnight.
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
    const to = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59).getTime()

    const events = parseIcs(text, from, to).slice(0, MAX_EVENTS)

    return {
      data: {
        events,
        fetchedAt: new Date().toISOString(),
      },
      // Calendars change during the working day, and a stale board is worse
      // than a slightly chatty one — but every screen reads this manager's
      // cache, so it stays one request whatever the fleet size.
      ttlSeconds: 10 * 60,
    }
  },

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const theme = resolveTheme(c.theme, c.backgroundColor, c.textColor)
    const data = (ctx.data ?? null) as { events?: CalEvent[] } | null
    const photo = String(c.photo ?? '')

    const cfg = {
      view: String(c.view ?? 'agenda'),
      title: String(c.title ?? 'My Calendar'),
      photo: photo ? ctx.baseUrl + photo : '',
      clock24: c.clockFormat === '24h',
      hideAllDay: c.hideDeclined === true,
      maxPerDay: Math.max(1, Math.min(20, Number(c.maxPerDay ?? 6))),
      weatherUrl: String(c.weatherAppId ?? '').trim()
        ? `${ctx.baseUrl}/tv/app/${encodeURIComponent(String(c.weatherAppId).trim())}/data`
        : '',
      dataUrl: `${ctx.baseUrl}/tv/app/${ctx.instance.id}/data`,
      fg: theme.fg,
      muted: theme.muted,
      empty: 'Nothing scheduled',
      waiting: 'Loading the calendar…',
    }

    return appPage({
      title: `Calendar — ${escapeHtml(ctx.instance.name)}`,
      bg: theme.bg,
      fontCss: ctx.fontCss,
      css: GCAL_CSS(theme),
      body: '<div id="root"></div>',
      script:
        `var CFG = ${jsonLiteral(cfg)};\n` +
        // Only carried when a Weather app is referenced — the icon set is not
        // large, but a calendar with no weather has no use for it.
        `var ICONS = ${jsonLiteral(cfg.weatherUrl ? allIcons() : {})};\n` +
        `var SEED = ${jsonLiteral(data ? { data: { events: data.events ?? [] } } : null)};\n` +
        GCAL_JS,
    })
  },

  serializeData(ctx: AppContext) {
    const d = (ctx.data ?? null) as { events?: CalEvent[] } | null
    return d ? { events: d.events ?? [] } : null
  },
}
