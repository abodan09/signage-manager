import type { AppContext, AppDefinition } from '../types'
import { appPage, escapeHtml, jsonLiteral, resolveTheme } from '../render'
import { CLOCK_JS, clockCss } from './face'
import { COMMON_ZONES, isKnownZone, zoneSchedule } from './zones'

// Simple Clock.
//
// Digital or analogue, and correct in any timezone — including across a
// daylight-saving change, which a fixed UTC offset would get wrong for half
// the year. The manager works out when the offset changes and ships the
// schedule with the page, so the screen holds the right time offline for
// eighteen months without asking anything of the network.
//
// The face is written to draw N clocks, so World Clock is the same board with
// more entries rather than a second implementation.

export const simpleclock: AppDefinition = {
  id: 'clock',
  name: 'Simple Clock',
  icon: '🕐',
  description: 'A digital or analogue clock, in any timezone.',
  category: 'utility',
  defaultDuration: 20,

  fields: [
    {
      key: 'style', label: 'Style', type: 'select', required: true, default: 'digital',
      options: [
        { value: 'digital', label: 'Digital', hint: 'Large numerals with an optional date' },
        { value: 'analog', label: 'Analogue', hint: 'A dial with hour, minute and second hands' },
      ],
    },
    {
      key: 'timeZone', label: 'Time zone', type: 'select', default: '',
      options: COMMON_ZONES,
      help: 'Daylight saving is handled for you — the clock changes with the zone.',
    },
    {
      key: 'customZone', label: 'Another time zone', type: 'text', maxLength: 60, advanced: true,
      placeholder: 'America/Bogota',
      help: 'An IANA name, if the one you need is not in the list above. Overrides the choice above.',
    },
    {
      key: 'label', label: 'Label', type: 'text', maxLength: 40,
      placeholder: 'Head office',
      help: 'Shown above the clock. Leave empty for none.',
    },
    {
      key: 'clockFormat', label: 'Hours', type: 'select', required: true, default: '24h',
      options: [
        { value: '24h', label: '24 hour (23:58)' },
        { value: '12h', label: '12 hour (11:58 PM)' },
      ],
    },
    {
      key: 'showSeconds', label: 'Show seconds', type: 'checkbox', default: true,
    },
    {
      key: 'dateFormat', label: 'Date', type: 'select', default: 'numeric',
      options: [
        { value: 'none', label: 'No date' },
        { value: 'numeric', label: '02/03' },
        { value: 'weekday', label: 'Monday' },
        { value: 'long', label: 'Monday, Mar 2' },
      ],
    },
    {
      key: 'theme', label: 'Theme', type: 'select', required: true, default: 'dark',
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
    const custom = String(config.customZone ?? '').trim()
    if (custom && !isKnownZone(custom)) {
      return `"${custom}" is not a time zone name. Use the form Region/City, such as America/Bogota.`
    }
    return null
  },

  // No refresh hook: a clock that needed the network would be a poor clock.
  // The DST schedule is computed when the page is rendered and carried with it.

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const theme = resolveTheme(c.theme, c.backgroundColor, c.textColor)
    const accent = /^#[0-9a-fA-F]{6}$/.test(String(c.accent)) ? String(c.accent) : '#f5a623'

    const zone = String(c.customZone ?? '').trim() || String(c.timeZone ?? '').trim()
    const clocks = [{
      label: String(c.label ?? '').trim(),
      // No zone means the screen's own clock, which is what most people want
      // and needs no schedule at all.
      shifts: zone && isKnownZone(zone) ? zoneSchedule(zone) : null,
    }]

    const cfg = {
      style: String(c.style ?? 'digital'),
      clock24: c.clockFormat !== '12h',
      showSeconds: c.showSeconds !== false,
      dateFormat: String(c.dateFormat ?? 'numeric'),
    }

    return appPage({
      title: `Clock — ${escapeHtml(ctx.instance.name)}`,
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

  suggestName(ctx: AppContext) {
    const zone = String(ctx.instance.config.customZone ?? '').trim()
      || String(ctx.instance.config.timeZone ?? '').trim()
    return zone ? `Clock — ${zone.split('/').pop()?.replace(/_/g, ' ')}` : null
  },
}
