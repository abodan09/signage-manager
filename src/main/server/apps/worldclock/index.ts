import type { AppContext, AppDefinition, AppField } from '../types'
import { appPage, escapeHtml, jsonLiteral, resolveTheme } from '../render'
import { CLOCK_JS, clockCss } from './../clock/face'
import { COMMON_ZONES, isKnownZone, zoneSchedule } from './../clock/zones'

// World Clock.
//
// Simple Clock's board with more entries on it. The face was written to draw N
// clocks and sizes its tiles from the count, so six cities lay themselves out
// three across and two down with nothing here to arrange them — and the offset
// schedules come from the same DST machinery, computed on this PC and carried
// with the page so a screen stays right for eighteen months without a network.
//
// The rows are declared as ordinary fields rather than a list editor. It keeps
// the promise the whole app framework is built on — a new app is a server file
// and nothing else — and it means each city's zone is a plain select, validated
// against the same closed list as Simple Clock's, instead of a bespoke editor
// re-implementing that check.

const MAX_CLOCKS = 8

/** Which counts still show row `n`. Compared with ===, and a select always
 *  yields a string, so these must be strings — numbers here would silently
 *  never match and the row would stay hidden for ever. */
function shownFrom(n: number): string[] {
  const out: string[] = []
  for (let i = Math.max(2, n); i <= MAX_CLOCKS; i++) out.push(String(i))
  return out
}

/** A board that already works before the operator touches anything: six cities
 *  across the world's business hours, each labelled the way it would be on a
 *  wall rather than by its IANA name. */
const DEFAULTS: Array<{ label: string; zone: string }> = [
  { label: 'San Francisco', zone: 'America/Los_Angeles' },
  { label: 'New York', zone: 'America/New_York' },
  { label: 'London', zone: 'Europe/London' },
  { label: 'Paris', zone: 'Europe/Paris' },
  { label: 'Dubai', zone: 'Asia/Dubai' },
  { label: 'Tokyo', zone: 'Asia/Tokyo' },
  { label: 'Singapore', zone: 'Asia/Singapore' },
  { label: 'Sydney', zone: 'Australia/Sydney' },
]

function clockFields(): AppField[] {
  const out: AppField[] = []
  for (let i = 1; i <= MAX_CLOCKS; i++) {
    const d = DEFAULTS[i - 1]
    // Rows 1 and 2 always exist — a world clock with one clock is Simple Clock.
    const gate = i <= 2 ? undefined : { key: 'clockCount', equals: shownFrom(i) }
    out.push({
      key: `label${i}`, label: `Clock ${i} — name`, type: 'text', maxLength: 40,
      default: d.label, placeholder: d.label, showIf: gate,
      help: i === 1 ? 'What the city is called on the wall. The zone below does the arithmetic.' : undefined,
    })
    out.push({
      key: `zone${i}`, label: `Clock ${i} — time zone`, type: 'select',
      default: d.zone, options: COMMON_ZONES, showIf: gate,
    })
  }
  return out
}

export const worldclock: AppDefinition = {
  id: 'worldclock',
  name: 'World Clock',
  icon: '🌍',
  description: 'Several clocks side by side, one per city, each correct through daylight saving.',
  category: 'utility',
  defaultDuration: 30,

  fields: [
    {
      key: 'style', label: 'Style', type: 'select', required: true, default: 'digital',
      options: [
        { value: 'digital', label: 'Digital', hint: 'Large numerals with an optional date' },
        { value: 'analog', label: 'Analogue', hint: 'A dial with hour, minute and second hands' },
      ],
    },
    {
      key: 'clockCount', label: 'How many clocks', type: 'select', required: true, default: '6',
      options: [
        { value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' },
        { value: '5', label: '5' }, { value: '6', label: '6', hint: 'Three across, two down' },
        { value: '7', label: '7' }, { value: '8', label: '8' },
      ],
      help: 'They size themselves to fit — fewer clocks are drawn larger.',
    },
    ...clockFields(),
    {
      key: 'clockFormat', label: 'Hours', type: 'select', required: true, default: '12h',
      options: [
        { value: '24h', label: '24 hour (23:58)' },
        { value: '12h', label: '12 hour (11:58 PM)' },
      ],
    },
    {
      key: 'showSeconds', label: 'Show seconds', type: 'checkbox', default: true,
    },
    {
      key: 'dateFormat', label: 'Date', type: 'select', default: 'none',
      options: [
        { value: 'none', label: 'No date' },
        { value: 'numeric', label: '02/03' },
        { value: 'weekday', label: 'Monday' },
        { value: 'long', label: 'Monday, Mar 2' },
      ],
      help: 'A date under every clock crowds the board — usually worth leaving off.',
    },
    {
      key: 'theme', label: 'Theme', type: 'select', required: true, default: 'light',
      options: [
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
        { value: 'custom', label: 'Custom' },
      ],
    },
    {
      key: 'backgroundColor', label: 'Background Colour', type: 'color', default: '#222222',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'textColor', label: 'Text Colour', type: 'color', default: '#ffffff',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'accent', label: 'Second hand colour', type: 'color', default: '#f5a623', advanced: true,
      showIf: { key: 'style', equals: ['analog'] },
    },
  ],

  validate(config) {
    const count = Math.max(2, Math.min(MAX_CLOCKS, Number(config.clockCount) || 6))
    for (let i = 1; i <= count; i++) {
      const zone = String(config[`zone${i}`] ?? '').trim()
      // '' is legitimate — it means this screen's own time.
      if (zone && !isKnownZone(zone)) {
        return `Clock ${i} has a time zone this computer does not recognise.`
      }
    }
    return null
  },

  // No refresh hook. A clock that needed the network would be a poor clock, and
  // the DST schedules are computed here at render time and travel with the page.

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const theme = resolveTheme(c.theme, c.backgroundColor, c.textColor)
    const accent = /^#[0-9a-fA-F]{6}$/.test(String(c.accent)) ? String(c.accent) : '#f5a623'
    const count = Math.max(2, Math.min(MAX_CLOCKS, Number(c.clockCount) || 6))

    const clocks = []
    for (let i = 1; i <= count; i++) {
      const zone = String(c[`zone${i}`] ?? '').trim()
      clocks.push({
        label: String(c[`label${i}`] ?? '').trim(),
        // No zone means the screen's own clock, which needs no schedule at all.
        shifts: zone && isKnownZone(zone) ? zoneSchedule(zone) : null,
      })
    }

    const cfg = {
      style: String(c.style ?? 'digital'),
      clock24: c.clockFormat !== '12h',
      showSeconds: c.showSeconds !== false,
      dateFormat: String(c.dateFormat ?? 'none'),
    }

    return appPage({
      title: `World Clock — ${escapeHtml(ctx.instance.name)}`,
      bg: theme.bg,
      fontCss: ctx.fontCss,
      css: clockCss(theme, accent),
      body: '<div id="root"></div>',
      script:
        `var CFG = ${jsonLiteral(cfg)};\n` +
        `var CLOCKS = ${jsonLiteral(clocks)};\n` +
        CLOCK_JS,
    })
  },
}
