// Weather icons, drawn as inline SVG.
//
// Not fetched from anywhere: a weather board is the app most likely to be the
// only thing on a screen in a room with flaky wi-fi, and an icon set that
// fails to load turns it into a page of numbers. Line art on a 64-unit grid,
// stroked in currentColor so one set serves every theme.

export type IconId =
  | 'clear-day' | 'clear-night'
  | 'partly-day' | 'partly-night'
  | 'cloudy' | 'overcast' | 'fog'
  | 'drizzle' | 'rain' | 'heavy-rain' | 'showers'
  | 'snow' | 'sleet' | 'hail'
  | 'thunder' | 'thunder-hail'

const SUN = '<circle cx="32" cy="32" r="11"/>' +
  '<path d="M32 12v-6M32 58v-6M52 32h6M6 32h6M46.1 17.9l4.2-4.2M13.7 50.3l4.2-4.2M46.1 46.1l4.2 4.2M13.7 13.7l4.2 4.2"/>'

const MOON = '<path d="M40.5 12a20 20 0 1 0 12.4 25.6A16.5 16.5 0 0 1 40.5 12z"/>'

/** The cloud used by every cloudy variant, sitting low enough to leave room
 *  above for a sun or moon and below for precipitation. */
const CLOUD = '<path d="M20.5 45.5h24a9.5 9.5 0 0 0 .6-19 14 14 0 0 0-26.6 3.6 8.2 8.2 0 0 0 2 15.4z"/>'

/** A smaller cloud, pushed right and down, so the peeking sun reads clearly. */
const CLOUD_SM = '<path d="M24 47h21a8.5 8.5 0 0 0 .5-17 12.5 12.5 0 0 0-23.7 3.2A7.3 7.3 0 0 0 24 47z"/>'

const SUN_PEEK = '<circle cx="24" cy="21" r="7.5"/>' +
  '<path d="M24 8v-4M24 38v-3M37 21h4M7 21h4M33.2 11.8l2.8-2.8M12 33l2.8-2.8M12 9l2.8 2.8"/>'

const MOON_PEEK = '<path d="M28.5 9a11 11 0 1 0 6.8 14 9 9 0 0 1-6.8-14z"/>'

const drops = (xs: number[], y = 50, len = 8) =>
  xs.map(x => `<path d="M${x} ${y}l-2.5 ${len}"/>`).join('')

const flakes = (xs: number[], y = 53) =>
  xs.map(x => `<path d="M${x} ${y - 3}v6M${x - 2.6} ${y - 1.5}l5.2 3M${x - 2.6} ${y + 1.5}l5.2-3"/>`).join('')

const BOLT = '<path d="M33 47l-7 11h7l-2 9 9-12h-7l3-8z" stroke-linejoin="round"/>'

const PATHS: Record<IconId, string> = {
  'clear-day': SUN,
  'clear-night': MOON,
  'partly-day': SUN_PEEK + CLOUD_SM,
  'partly-night': MOON_PEEK + CLOUD_SM,
  'cloudy': CLOUD_SM + '<path d="M14 38a7 7 0 0 1 1.6-13.6 11 11 0 0 1 18.6-4"/>',
  'overcast': CLOUD,
  'fog': CLOUD + '<path d="M14 53h24M18 59h20"/>',
  'drizzle': CLOUD + drops([26, 34, 42], 50, 5),
  'rain': CLOUD + drops([26, 34, 42], 50, 9),
  'heavy-rain': CLOUD + drops([23, 30, 37, 44], 50, 11),
  'showers': SUN_PEEK + CLOUD_SM + drops([29, 38], 52, 8),
  'snow': CLOUD + flakes([26, 38]),
  'sleet': CLOUD + drops([26], 50, 8) + flakes([38]),
  'hail': CLOUD + '<circle cx="27" cy="54" r="2.4"/><circle cx="37" cy="54" r="2.4"/><circle cx="32" cy="61" r="2.4"/>',
  'thunder': CLOUD + BOLT,
  'thunder-hail': CLOUD + BOLT + '<circle cx="24" cy="55" r="2.2"/><circle cx="45" cy="55" r="2.2"/>',
}

/** One icon as an <svg>. `size` is a CSS length; stroke follows the text
 *  colour so a theme change needs no new markup. */
export function weatherIcon(id: IconId, size = '100%', strokeWidth = 2.4): string {
  const d = PATHS[id] ?? PATHS.cloudy
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" aria-hidden="true">${d}</svg>`
}

/** Every icon, so a page can carry the whole set and swap without a request. */
export function allIcons(): Record<string, string> {
  const out: Record<string, string> = {}
  ;(Object.keys(PATHS) as IconId[]).forEach(id => { out[id] = PATHS[id] })
  return out
}

// ── WMO weather interpretation codes ─────────────────────────────────────────

/** The codes Open-Meteo returns, mapped to an icon and a label people use.
 *  Day and night differ only for the clear and partly-cloudy codes; rain looks
 *  the same at midnight as at noon. */
const CODES: Record<number, { label: string; day: IconId; night?: IconId }> = {
  0:  { label: 'Clear',              day: 'clear-day',   night: 'clear-night' },
  1:  { label: 'Mainly clear',       day: 'clear-day',   night: 'clear-night' },
  2:  { label: 'Partly cloudy',      day: 'partly-day',  night: 'partly-night' },
  3:  { label: 'Overcast',           day: 'overcast' },
  45: { label: 'Fog',                day: 'fog' },
  48: { label: 'Freezing fog',       day: 'fog' },
  51: { label: 'Light drizzle',      day: 'drizzle' },
  53: { label: 'Drizzle',            day: 'drizzle' },
  55: { label: 'Heavy drizzle',      day: 'rain' },
  56: { label: 'Freezing drizzle',   day: 'sleet' },
  57: { label: 'Freezing drizzle',   day: 'sleet' },
  61: { label: 'Light rain',         day: 'drizzle' },
  63: { label: 'Rain',               day: 'rain' },
  65: { label: 'Heavy rain',         day: 'heavy-rain' },
  66: { label: 'Freezing rain',      day: 'sleet' },
  67: { label: 'Freezing rain',      day: 'sleet' },
  71: { label: 'Light snow',         day: 'snow' },
  73: { label: 'Snow',               day: 'snow' },
  75: { label: 'Heavy snow',         day: 'snow' },
  77: { label: 'Snow grains',        day: 'snow' },
  80: { label: 'Light showers',      day: 'showers' },
  81: { label: 'Showers',            day: 'rain' },
  82: { label: 'Heavy showers',      day: 'heavy-rain' },
  85: { label: 'Snow showers',       day: 'snow' },
  86: { label: 'Heavy snow showers', day: 'snow' },
  95: { label: 'Thunderstorm',       day: 'thunder' },
  96: { label: 'Thunderstorm, hail', day: 'thunder-hail' },
  99: { label: 'Thunderstorm, hail', day: 'thunder-hail' },
}

export function describeCode(code: number, isDay = true): { label: string; icon: IconId } {
  const hit = CODES[code]
  if (!hit) return { label: 'Unknown', icon: 'cloudy' }
  return { label: hit.label, icon: (!isDay && hit.night) ? hit.night : hit.day }
}

/** Which backdrop suits the conditions. The photo itself is the operator's,
 *  but the gradient behind it is picked from the sky so a board with no photo
 *  still looks like the weather it is describing. */
export function skyFor(code: number, isDay: boolean): { from: string; to: string; dark: boolean } {
  if (!isDay) return { from: '#0f2027', to: '#243b55', dark: true }
  if (code === 0 || code === 1) return { from: '#4a90d9', to: '#89c4f4', dark: false }
  if (code === 2) return { from: '#5b9bd5', to: '#a8c9e8', dark: false }
  if (code === 3) return { from: '#7a8b99', to: '#b9c4cc', dark: false }
  if (code === 45 || code === 48) return { from: '#8d9aa5', to: '#c8ced3', dark: false }
  if (code >= 95) return { from: '#2c3e50', to: '#4c5c6b', dark: true }
  if (code >= 71 && code <= 86) return { from: '#7f9cb5', to: '#d3e2ee', dark: false }
  return { from: '#4b6478', to: '#8fa6b8', dark: false }   // rain and drizzle
}
