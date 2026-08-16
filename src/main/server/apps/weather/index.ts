import type { AppContext, AppDefinition, AppRefreshResult } from '../types'
import { appPage, escapeHtml, jsonLiteral, resolveTheme } from '../render'
import { allIcons, describeCode, skyFor, weatherIcon } from './icons'
import { WEATHER_CSS, WEATHER_JS } from './views'

// Weather.
//
// Open-Meteo, deliberately: it needs no API key, so this app works the moment
// the product is installed. Nobody signs up for anything, no key ships in the
// binary, and there is no per-customer onboarding step. Geocoding is keyless
// there too, so an operator types "Vienna" and is done.
//
// The manager fetches; screens read the manager's cache. Fifty screens showing
// the same city cost one request every fifteen minutes, and a board keeps
// showing this morning's forecast when the internet drops rather than going
// blank — which for weather is a perfectly respectable failure.

// Open-Meteo's hosted free tier is licensed for non-commercial use only, so a
// commercial install points these at its own instance instead — the server is
// AGPLv3 and self-hostable, which removes the licensing question entirely
// without changing a line of the code below.
//
//   SIGNAGE_WEATHER_URL=https://weather.example.com/v1/forecast
//   SIGNAGE_GEOCODE_URL=https://weather.example.com/v1/search
//
// Both default to the public service, which is correct for development and for
// anyone running this non-commercially.
const GEOCODE = process.env.SIGNAGE_GEOCODE_URL || 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = process.env.SIGNAGE_WEATHER_URL || 'https://api.open-meteo.com/v1/forecast'

/** Open-Meteo's licence: "You must include a link next to any location
 *  Open-Meteo data are displayed." A screen has no clickable link, so the
 *  credit text carries it. Change this alongside the endpoints above if the
 *  provider ever changes — the two belong together. */
export const WEATHER_ATTRIBUTION = 'Weather data by Open-Meteo.com'

interface Day {
  date: string
  code: number
  max: number
  min: number
}

interface WxData {
  place: string
  temp: number
  feelsLike: number
  humidity: number
  wind: number
  windUnit: string
  code: number
  isDay: boolean
  tempUnit: string
  timezone: string
  utcOffset: number
  days: Day[]
  fetchedAt: string
}

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SignageManager/1.0' } })
    if (!res.ok) throw new Error(`Weather service returned ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** "Vienna", "Vienna, Austria", "10001" or "48.21,16.37" all resolve. */
async function resolvePlace(query: string): Promise<{ name: string; lat: number; lon: number }> {
  const q = query.trim()
  const coords = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(q)
  if (coords) {
    const lat = Number(coords[1]), lon = Number(coords[2])
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Those coordinates are outside the world.')
    return { name: q, lat, lon }
  }

  // Only the part before a comma is sent: the service matches place names, and
  // "Vienna, Austria" as one string finds nothing.
  const primary = q.split(',')[0].trim()
  const data = await getJson(
    `${GEOCODE}?name=${encodeURIComponent(primary)}&count=10&language=en&format=json`,
  ) as { results?: Array<Record<string, unknown>> }

  const results = data.results ?? []
  if (!results.length) throw new Error(`Could not find "${q}". Try adding the country, or use coordinates.`)

  // With a country or region given, prefer the match that agrees with it.
  const hint = q.includes(',') ? q.split(',').slice(1).join(',').trim().toLowerCase() : ''
  const best = (hint && results.find(r =>
    String(r.country ?? '').toLowerCase().includes(hint) ||
    String(r.admin1 ?? '').toLowerCase().includes(hint) ||
    String(r.country_code ?? '').toLowerCase() === hint,
  )) || results[0]

  const parts = [String(best.name ?? '')]
  if (best.country) parts.push(String(best.country))
  return { name: parts.join(', '), lat: Number(best.latitude), lon: Number(best.longitude) }
}

export const weather: AppDefinition = {
  id: 'weather',
  name: 'Weather',
  icon: '⛅',
  description: 'Current conditions and a seven-day forecast for any location.',
  category: 'information',
  defaultDuration: 30,

  fields: [
    {
      key: 'location', label: 'Location', type: 'text', required: true, maxLength: 120,
      placeholder: 'Vienna, Austria',
      help: 'A town, a city, or coordinates as "48.21, 16.37". Add the country if the name is a common one.',
    },
    {
      key: 'units', label: 'Temperature', type: 'select', required: true, default: 'celsius',
      options: [
        { value: 'celsius', label: 'Celsius (°C)' },
        { value: 'fahrenheit', label: 'Fahrenheit (°F)' },
      ],
    },
    {
      key: 'style', label: 'Style', type: 'select', required: true, default: 'wall',
      options: [
        { value: 'wall', label: 'Weather Wall', hint: 'Full-screen backdrop, big temperature, forecast strip along the bottom' },
        { value: 'split', label: 'Split', hint: 'Picture on one side, conditions and forecast on the other' },
        { value: 'flat', label: 'Flat panels', hint: 'No photography — a colour block and a column per day' },
      ],
    },
    {
      key: 'theme', label: 'Colours', type: 'select', required: true, default: 'auto',
      options: [
        { value: 'auto', label: 'Match the weather', hint: 'The backdrop follows the sky — blue when clear, grey in rain, dark at night' },
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
        { value: 'custom', label: 'Custom' },
      ],
    },
    {
      key: 'backgroundColor', label: 'Background Colour', type: 'color', default: '#0b3d68',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'textColor', label: 'Text Colour', type: 'color', default: '#ffffff',
      showIf: { key: 'theme', equals: ['custom'] },
    },
    {
      key: 'photo', label: 'Background picture', type: 'image',
      help: 'Optional. Leave empty and the backdrop is a gradient chosen from the current conditions.',
      showIf: { key: 'style', equals: ['wall', 'split'] },
    },

    // ── Advanced ──
    {
      key: 'forecastDays', label: 'Days to show', type: 'number', default: 7, min: 3, max: 7, advanced: true,
    },
    {
      key: 'windUnit', label: 'Wind speed', type: 'select', default: 'ms', advanced: true,
      options: [
        { value: 'ms', label: 'Metres per second' },
        { value: 'kmh', label: 'Kilometres per hour' },
        { value: 'mph', label: 'Miles per hour' },
      ],
    },
    {
      key: 'clockFormat', label: 'Clock', type: 'select', default: '12h', advanced: true,
      options: [
        { value: '12h', label: '12 hour (3:30 PM)' },
        { value: '24h', label: '24 hour (15:30)' },
      ],
    },
    {
      key: 'showFeelsLike', label: 'Show "feels like"', type: 'checkbox', default: false, advanced: true,
    },
    {
      key: 'showDetails', label: 'Show humidity and wind', type: 'checkbox', default: true, advanced: true,
    },
  ],

  async refresh(ctx: AppContext): Promise<AppRefreshResult> {
    const c = ctx.instance.config
    const place = await resolvePlace(String(c.location ?? ''))
    const units = c.units === 'fahrenheit' ? 'fahrenheit' : 'celsius'
    const windUnit = ['ms', 'kmh', 'mph'].includes(String(c.windUnit)) ? String(c.windUnit) : 'ms'
    const days = Math.max(3, Math.min(7, Number(c.forecastDays ?? 7)))

    const url = `${FORECAST}?latitude=${place.lat}&longitude=${place.lon}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      `&timezone=auto&forecast_days=${days}` +
      `&temperature_unit=${units}&wind_speed_unit=${windUnit}`

    const f = await getJson(url) as {
      current?: Record<string, number | string>
      current_units?: Record<string, string>
      daily?: Record<string, Array<number | string>>
      timezone?: string
      utc_offset_seconds?: number
    }
    if (!f.current || !f.daily) throw new Error('The weather service sent an unexpected reply.')

    const d = f.daily
    const list: Day[] = (d.time ?? []).map((date, i) => ({
      date: String(date),
      code: Number(d.weather_code?.[i] ?? 0),
      max: Math.round(Number(d.temperature_2m_max?.[i] ?? 0)),
      min: Math.round(Number(d.temperature_2m_min?.[i] ?? 0)),
    }))

    const data: WxData = {
      place: place.name,
      temp: Math.round(Number(f.current.temperature_2m)),
      feelsLike: Math.round(Number(f.current.apparent_temperature)),
      humidity: Math.round(Number(f.current.relative_humidity_2m)),
      wind: Math.round(Number(f.current.wind_speed_10m) * 10) / 10,
      windUnit: f.current_units?.wind_speed_10m ?? 'm/s',
      code: Number(f.current.weather_code),
      isDay: Number(f.current.is_day) === 1,
      tempUnit: f.current_units?.temperature_2m ?? '°C',
      timezone: String(f.timezone ?? 'UTC'),
      utcOffset: Number(f.utc_offset_seconds ?? 0),
      days: list,
      fetchedAt: new Date().toISOString(),
    }

    // Fifteen minutes. Open-Meteo updates about that often, and it keeps a
    // fleet of screens well inside any fair-use expectation.
    return { data, ttlSeconds: 15 * 60 }
  },

  render(ctx: AppContext): string {
    const c = ctx.instance.config
    const data = (ctx.data ?? null) as WxData | null
    const style = String(c.style ?? 'wall')

    // The backdrop follows the sky unless the operator has said otherwise, so
    // a board reads as "grey and raining" before anyone has read a number.
    const themeChoice = String(c.theme ?? 'auto')
    const sky = skyFor(data?.code ?? 3, data?.isDay ?? true)
    const theme = themeChoice === 'auto'
      ? resolveTheme('custom', sky.dark ? '#16222e' : '#3f6fa5', sky.dark ? '#ffffff' : '#ffffff')
      : resolveTheme(themeChoice, c.backgroundColor, c.textColor)

    const photo = String(c.photo ?? '')
    const photoUrl = photo ? ctx.baseUrl + photo : ''

    const cfg = {
      style,
      auto: themeChoice === 'auto',
      gradientFrom: sky.from,
      gradientTo: sky.to,
      photo: photoUrl,
      fg: theme.fg,
      muted: theme.muted,
      card: theme.card,
      clock24: c.clockFormat === '24h',
      showFeelsLike: c.showFeelsLike === true,
      showDetails: c.showDetails !== false,
      dataUrl: `${ctx.baseUrl}/tv/app/${ctx.instance.id}/data`,
      waiting: 'Fetching the forecast…',
      failed: 'Weather is unavailable',
      // Required by the data provider's licence wherever the forecast is
      // shown. Not a setting: an operator must not be able to switch it off.
      attribution: WEATHER_ATTRIBUTION,
    }

    return appPage({
      title: `Weather — ${escapeHtml(ctx.instance.name)}`,
      bg: theme.bg,
      fontCss: ctx.fontCss,
      css: WEATHER_CSS(theme),
      body: '<div id="root"></div>',
      script:
        `var CFG = ${jsonLiteral(cfg)};\n` +
        `var ICONS = ${jsonLiteral(allIcons())};\n` +
        `var SEED = ${jsonLiteral(data ? { data: viewData(ctx) } : null)};\n` +
        WEATHER_JS,
    })
  },

  serializeData(ctx: AppContext) {
    return viewData(ctx)
  },

  suggestName(ctx: AppContext) {
    const d = (ctx.data ?? null) as WxData | null
    return d?.place ? `Weather — ${d.place}` : null
  },
}

/** Everything the page draws, with the icon and label already resolved so the
 *  page carries no weather-code table of its own. */
function viewData(ctx: AppContext) {
  const d = (ctx.data ?? null) as WxData | null
  if (!d) return null
  const now = describeCode(d.code, d.isDay)
  return {
    place: d.place,
    temp: d.temp,
    feelsLike: d.feelsLike,
    humidity: d.humidity,
    wind: d.wind,
    windUnit: d.windUnit,
    tempUnit: d.tempUnit,
    condition: now.label,
    icon: now.icon,
    utcOffset: d.utcOffset,
    days: d.days.map(day => {
      // Daytime icons for a forecast: a row of moons would be nonsense.
      const info = describeCode(day.code, true)
      return { date: day.date, max: day.max, min: day.min, icon: info.icon, label: info.label }
    }),
  }
}

export { weatherIcon }
