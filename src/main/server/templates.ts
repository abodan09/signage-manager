import type {
  FontStackId, Orientation, PresetId, PresetLayout, ResolvedTemplate, SlotId, Template, Theme, Zone,
} from './types'

// Layout geometry lives in code, not in db.json: it is engineering, not user
// data, so a future release can correct a preset for every install at once —
// and nothing a LAN client sends can reshape a screen.

const OFF: Zone = { z: 0, visible: false }

/** v1.6.0's exact geometry: media full-bleed, 80px-padded text overlay, a 72px
 *  ticker bar pinned to the bottom, and a 4px progress bar under it. */
const FULLSCREEN_ZONES: Record<SlotId, Zone> = {
  main:     { left: 0, right: 0, top: 0, bottom: 0, z: 1, fit: 'contain', visible: true },
  overlay:  { left: 0, right: 0, top: 0, bottom: 0, z: 5, pad: '80px', align: 'center', visible: true },
  ticker:   { left: 0, right: 0, bottom: 0, height: '72px', z: 6, visible: true },
  logo:     { ...OFF, right: '32px', top: '32px', width: '160px', height: '80px', z: 8 },
  clock:    { ...OFF, right: '32px', top: '32px', z: 8 },
  progress: { left: 0, right: 0, bottom: 0, height: '4px', z: 10, visible: true },
}

function zones(overrides: Partial<Record<SlotId, Partial<Zone>>>): Record<SlotId, Zone> {
  const out = {} as Record<SlotId, Zone>
  ;(Object.keys(FULLSCREEN_ZONES) as SlotId[]).forEach(slot => {
    out[slot] = { ...FULLSCREEN_ZONES[slot], ...(overrides[slot] ?? {}) }
  })
  return out
}

export const PRESETS: Record<PresetId, PresetLayout> = {
  'fullscreen': {
    id: 'fullscreen',
    name: 'Fullscreen',
    description: 'Media fills the screen; text floats on top. The original layout.',
    orientation: 'any',
    zones: FULLSCREEN_ZONES,
  },

  'fullscreen-ticker': {
    id: 'fullscreen-ticker',
    name: 'Fullscreen + Ticker',
    description: 'Media sits above a permanent bottom news bar, so nothing is covered.',
    orientation: 'landscape',
    zones: zones({
      main:     { bottom: '72px' },
      overlay:  { bottom: '72px' },
      progress: { bottom: '72px' },
    }),
  },

  'lower-third': {
    id: 'lower-third',
    name: 'Lower Third',
    description: 'Text is pinned to a band across the lower third — good for captions over video.',
    orientation: 'landscape',
    zones: zones({
      overlay:  { top: 'auto', bottom: '72px', height: '26%', pad: '40px', align: 'end' },
      progress: { bottom: '72px' },
    }),
  },

  'branded-frame': {
    id: 'branded-frame',
    name: 'Branded Frame',
    description: 'Content is inset inside your brand colour, with room for a logo and clock.',
    orientation: 'landscape',
    zones: zones({
      main:     { left: 4, right: 4, top: 12, bottom: '92px' },
      overlay:  { left: 4, right: 4, top: 12, bottom: '92px', pad: '40px' },
      ticker:   { left: 0, right: 0, bottom: 0, height: '72px' },
      logo:     { visible: true, left: '40px', top: '24px', width: '200px', height: '64px', z: 8 },
      clock:    { visible: true, right: '40px', top: '24px', z: 8 },
      progress: { bottom: '72px' },
    }),
  },

  'welcome-lobby': {
    id: 'welcome-lobby',
    name: 'Welcome / Lobby',
    description: 'A large centred message over the media, with the logo top-left and a clock.',
    orientation: 'landscape',
    zones: zones({
      overlay: { pad: '120px', align: 'center' },
      logo:    { visible: true, left: '48px', top: '40px', width: '220px', height: '90px', z: 8 },
      clock:   { visible: true, right: '48px', top: '40px', z: 8 },
    }),
  },

  'portrait-poster': {
    id: 'portrait-poster',
    name: 'Portrait Poster',
    description: 'For screens mounted vertically: media on top, a tall caption band beneath.',
    orientation: 'portrait',
    zones: zones({
      main:     { bottom: '32%', fit: 'cover' },
      overlay:  { top: 'auto', height: '32%', bottom: 0, pad: '48px', align: 'center' },
      ticker:   { visible: false },
      progress: { bottom: 0 },
    }),
  },
}

const FONT_STACKS: Record<FontStackId, string> = {
  'sans':        'Arial, Helvetica, sans-serif',
  'sans-narrow': '"Arial Narrow", Arial, Helvetica, sans-serif',
  'serif':       'Georgia, "Times New Roman", serif',
  'mono':        '"Courier New", Courier, monospace',
}

/** Defaults chosen so a themed item looks like today's player output. */
export function defaultTheme(): Theme {
  return {
    bgColor: '#000000',
    brandColor: '#3b82f6',
    textColor: '#ffffff',
    bandColor: '#000000',
    bandOpacity: 75,
    fontStack: 'sans',
    fontScale: 1,
    showLogo: false,
    showClock: false,
    clockFormat: '24h',
    showClockDate: false,
    tickerEnabled: true,
    transitionMs: 600,
  }
}

export const BUILTIN_PREFIX = 'builtin:'
export const DEFAULT_TEMPLATE_ID = `${BUILTIN_PREFIX}fullscreen`

export function isBuiltinId(id: string): boolean {
  return typeof id === 'string' && id.indexOf(BUILTIN_PREFIX) === 0
}

/** The six presets exposed as read-only templates, so a preset can be assigned
 *  without creating any record. */
export function builtinTemplates(): Template[] {
  const now = '1970-01-01T00:00:00.000Z'
  return (Object.keys(PRESETS) as PresetId[]).map(id => ({
    id: BUILTIN_PREFIX + id,
    name: PRESETS[id].name,
    preset: id,
    theme: defaultTheme(),
    createdAt: now,
    updatedAt: now,
  }))
}

const clampZ = (z: number) => Math.max(0, Math.min(99, Math.round(Number(z) || 0)))

export function resolveTemplate(t: Template): ResolvedTemplate {
  const preset = PRESETS[t.preset] ?? PRESETS.fullscreen
  const theme = { ...defaultTheme(), ...t.theme }
  const out = {} as Record<SlotId, Zone>
  ;(Object.keys(preset.zones) as SlotId[]).forEach(slot => {
    const z = preset.zones[slot]
    // progress is player chrome and keeps its own layer above user zones.
    out[slot] = slot === 'progress' ? { ...z } : { ...z, z: clampZ(z.z) }
  })
  // The ticker can be switched off wholesale by the theme.
  if (!theme.tickerEnabled) out.ticker = { ...out.ticker, visible: false }
  if (!theme.showLogo)  out.logo  = { ...out.logo,  visible: false }
  if (!theme.showClock) out.clock = { ...out.clock, visible: false }

  return {
    id: t.id,
    name: t.name,
    preset: preset.id,
    orientation: preset.orientation as Orientation,
    zones: out,
    theme,
    fontFamily: FONT_STACKS[theme.fontStack] ?? FONT_STACKS.sans,
    updatedAt: t.updatedAt,
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/
const PX  = /^-?\d+(\.\d+)?px$/

/** Validates and normalises operator-supplied theme values. */
export function sanitizeTheme(input: unknown): { ok: true; theme: Theme } | { ok: false; error: string } {
  const base = defaultTheme()
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const theme: Theme = { ...base }

  for (const key of ['bgColor', 'brandColor', 'textColor', 'bandColor'] as const) {
    if (src[key] === undefined) continue
    if (typeof src[key] !== 'string' || !HEX.test(src[key] as string)) {
      return { ok: false, error: `${key} must be a hex colour like #3b82f6` }
    }
    theme[key] = src[key] as string
  }
  if (src.bandOpacity !== undefined) {
    const n = Number(src.bandOpacity)
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: 'bandOpacity must be 0–100' }
    theme.bandOpacity = Math.round(n)
  }
  if (src.fontStack !== undefined) {
    if (!(String(src.fontStack) in FONT_STACKS)) return { ok: false, error: 'Unknown font' }
    theme.fontStack = src.fontStack as FontStackId
  }
  if (src.fontScale !== undefined) {
    const n = Number(src.fontScale)
    if (![0.75, 1, 1.25, 1.5].includes(n)) return { ok: false, error: 'fontScale must be 0.75, 1, 1.25 or 1.5' }
    theme.fontScale = n
  }
  if (src.logoPath !== undefined && src.logoPath !== null && src.logoPath !== '') {
    if (typeof src.logoPath !== 'string' || !/^\/uploads\/[A-Za-z0-9._-]+$/.test(src.logoPath)) {
      return { ok: false, error: 'Logo must be an uploaded image' }
    }
    theme.logoPath = src.logoPath
  }
  if (src.clockFormat !== undefined) {
    if (src.clockFormat !== '12h' && src.clockFormat !== '24h') return { ok: false, error: "clockFormat must be '12h' or '24h'" }
    theme.clockFormat = src.clockFormat
  }
  if (src.transitionMs !== undefined) {
    const n = Number(src.transitionMs)
    if (![0, 300, 400, 500, 600].includes(n)) return { ok: false, error: 'transitionMs must be 0, 300, 400, 500 or 600' }
    theme.transitionMs = n
  }
  for (const key of ['showLogo', 'showClock', 'showClockDate', 'tickerEnabled'] as const) {
    if (src[key] !== undefined) theme[key] = src[key] !== false
  }
  return { ok: true, theme }
}

export { FONT_STACKS, PX as PX_RE }
