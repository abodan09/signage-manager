export type ContentType = 'image' | 'video' | 'html' | 'text' | 'design'
export type ScheduleMode = 'loop' | 'scheduled' | 'manual'
export type TextPosition = 'center' | 'top' | 'bottom' | 'ticker'

export interface ContentItem {
  id: string
  name: string
  type: ContentType
  // image / video
  filePath?: string
  fileName?: string
  mimeType?: string
  // html
  htmlUrl?: string
  // design — the id of a Design rendered by GET /tv/scene/:id
  designId?: string
  // text
  textContent?: string
  textBgColor?: string
  textFgColor?: string
  textFontSize?: number
  textPosition?: TextPosition
  // overlay (text type) — runs concurrently on top of main media
  overlayOpacity?: number  // 0–100, default 85
  // project membership
  projectId?: string
  // display
  durationSeconds: number
  // scheduling
  scheduleMode: ScheduleMode
  scheduleStartTime?: string
  scheduleEndTime?: string
  scheduleDays?: string[]
  // meta
  isActive: boolean
  orderIndex: number
  createdAt: string
  updatedAt: string
  /** Who supplies colour/size/opacity for a text item. 'custom' = the item's own
   *  fields (v1.6.0 behaviour, including its whole-layer opacity quirk);
   *  'theme' = the screen's template supplies them. Existing items are stamped
   *  'custom' on load so nothing already on a wall changes appearance.
   *  textPosition is never overridden — it always routes the item to a zone. */
  styleSource?: 'custom' | 'theme'
}

export interface Project {
  id: string
  name: string
  description?: string
  /** Applies only while this project is pushed, so a screen's shape never
   *  changes as the ambient rotation moves on. */
  templateId?: string
  // shared settings applied to every content item in this project
  durationSeconds: number
  scheduleMode: ScheduleMode
  scheduleStartTime?: string
  scheduleEndTime?: string
  scheduleDays?: string[]
  isActive: boolean
  orderIndex: number
  createdAt: string
  updatedAt: string
}

/** 'legacy'   = already in db.json before pairing existed; trusted forever.
 *  'unpaired' = registered openly after this release; refused in 'required' mode.
 *  'paired'   = holds a server-issued token. */
export type PairingState = 'legacy' | 'unpaired' | 'paired'
export type DevicePlatform = 'android' | 'webos' | 'tizen' | 'browser' | 'unknown'

export interface Device {
  id: string
  name: string
  ipAddress?: string
  lastSeen?: string
  status: 'online' | 'offline'
  registeredAt: string
  // Group membership. A screen can belong to several groups at once — a lobby
  // TV is plausibly both "Ground Floor" and "Welcome Screens".
  groupIds?: string[]
  pairingState: PairingState
  /** sha256 of the device token. NEVER serialised into an HTTP response — every
   *  Device leaves through publicDevice() in routes/_serialize.ts. */
  tokenHash?: string
  pairedAt?: string
  platform?: DevicePlatform
  playerVersion?: string
  /** Highest-priority template assignment. */
  templateId?: string
}

export interface AppSettings {
  /** Stable per-install id, minted once and advertised in the discovery beacon
   *  so a shell can tell "my manager moved IP" from "a different manager". */
  serverId: string
  pairingMode: 'open' | 'required'
  defaultTemplateId: string
  /** Set once the operator has chosen (or declined) template categories, so the
   *  first-run picker never reappears on an install that deliberately has none. */
  templatesOnboardedAt?: string
}

// ── Templates ────────────────────────────────────────────────────────────────

/** A CSS length. A number is a percentage of the viewport; a string is an exact
 *  pixel length ("72px"), used by presets to reproduce v1.6.0 geometry exactly
 *  at any panel resolution. */
export type Len = number | string

export type SlotId = 'main' | 'overlay' | 'ticker' | 'logo' | 'clock' | 'progress'

export type PresetId =
  | 'fullscreen'          // reproduces v1.6.0 exactly — the default
  | 'fullscreen-ticker'
  | 'lower-third'
  | 'branded-frame'
  | 'welcome-lobby'
  | 'portrait-poster'

export type ZoneFit = 'contain' | 'cover' | 'fill'
export type ZoneAlign = 'start' | 'center' | 'end'
export type Orientation = 'landscape' | 'portrait' | 'any'
export type FontStackId = 'sans' | 'sans-narrow' | 'serif' | 'mono'

/** Absolutely-positioned edges, never the `inset` shorthand — TV WebViews are
 *  often Chromium < 87, which drops `inset` and collapses the layer to 0×0.
 *  No transform/scale either: TVs composite video on a separate hardware plane
 *  and a transformed ancestor can blank it. */
export interface Zone {
  left?: Len
  right?: Len
  top?: Len
  bottom?: Len
  width?: Len
  height?: Len
  /** Preset zones are clamped to 0..99; player chrome owns 100+ so a zone can
   *  never cover the only on-screen diagnostics a TV has. */
  z: number
  pad?: Len
  fit?: ZoneFit
  align?: ZoneAlign
  visible: boolean
}

export interface PresetLayout {
  id: PresetId
  name: string
  description: string
  orientation: Orientation
  zones: Record<SlotId, Zone>
}

export interface Theme {
  bgColor: string
  brandColor: string
  textColor: string
  bandColor: string
  bandOpacity: number
  fontStack: FontStackId
  fontScale: number
  logoPath?: string
  showLogo: boolean
  showClock: boolean
  clockFormat: '12h' | '24h'
  showClockDate: boolean
  tickerEnabled: boolean
  transitionMs: number
}

/** Stored in db.json. Geometry is NOT stored — only the preset id. */
export interface Template {
  id: string
  name: string
  preset: PresetId
  theme: Theme
  createdAt: string
  updatedAt: string
}

/** What travels on the wire: geometry and the font stack already resolved, so
 *  the player holds no lookup tables. */
export interface ResolvedTemplate {
  id: string
  name: string
  preset: PresetId
  orientation: Orientation
  zones: Record<SlotId, Zone>
  theme: Theme
  fontFamily: string
  updatedAt: string
}

export interface DeviceGroup {
  id: string
  name: string
  color: string
  orderIndex: number
  createdAt: string
  updatedAt: string
  /** Fallback template for every screen in this group. */
  templateId?: string
}

// ── Designs (free-form canvas documents made in the Designer) ────────────────

/** Fonts a design may use. Every id resolves to a CSS stack in fonts.ts; ids
 *  with a bundled woff2 also get an @font-face served from /fonts, so scenes
 *  look identical on TVs that have no system fonts beyond one sans. */
export type SceneFontId =
  | 'sans' | 'sans-narrow' | 'serif' | 'mono'
  | 'inter' | 'oswald' | 'bebas' | 'playfair' | 'pacifico' | 'roboto-slab'

export type SceneElementType = 'text' | 'shape' | 'image' | 'qr'
export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'line'
export type SceneAlign = 'left' | 'center' | 'right'
export type SceneVAlign = 'top' | 'middle' | 'bottom'
export type SceneFit = 'contain' | 'cover' | 'fill'

/** Coordinates are in the design's own pixel space (width×height below); the
 *  scene renderer scales the whole stage to the panel, so one document fits
 *  every resolution. Array order is z-order — last element paints on top. */
export interface SceneElementBase {
  id: string
  type: SceneElementType
  name?: string
  x: number
  y: number
  w: number
  h: number
  rotation: number   // degrees
  opacity: number    // 0–100
  locked?: boolean
}

export interface TextElement extends SceneElementBase {
  type: 'text'
  text: string
  font: SceneFontId
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  align: SceneAlign
  valign: SceneVAlign
  color: string
  lineHeight: number      // multiplier
  letterSpacing: number   // px
  /** null = no band behind the text */
  bgColor: string | null
  bgOpacity: number       // 0–100, applies to bgColor only
  radius: number          // band corner radius
}

export interface ShapeElement extends SceneElementBase {
  type: 'shape'
  kind: ShapeKind
  /** null = hollow (stroke only) */
  fill: string | null
  fillOpacity: number     // 0–100
  stroke: string | null
  strokeWidth: number
  radius: number          // rect corner radius
}

export interface ImageElement extends SceneElementBase {
  type: 'image'
  /** An /uploads/ path, or null = placeholder frame the user fills with their
   *  own photo. Placeholders draw a hint in the Designer and nothing on TVs. */
  src: string | null
  fit: SceneFit
  radius: number
}

export interface QrElement extends SceneElementBase {
  type: 'qr'
  data: string
  fg: string
  /** null = transparent behind the modules */
  bg: string | null
}

export type SceneElement = TextElement | ShapeElement | ImageElement | QrElement

export interface SceneBackground {
  color: string
  gradient?: { from: string; to: string; angle: number }
  imagePath?: string
  imageFit?: SceneFit
}

/** Stored in db.json. Unlike zone Templates, geometry IS user data here — the
 *  whole point of the Designer — so it is strictly whitelisted by
 *  sanitizeDesign() and rendered only through renderSceneHtml(), which escapes
 *  every string. Nothing a design contains can inject markup into a screen. */
export interface Design {
  id: string
  name: string
  /** Template-pack provenance, so the Designer's template rail can offer the
   *  rest of the same category. */
  category?: string
  templateKey?: string
  width: number
  height: number
  background: SceneBackground
  elements: SceneElement[]
  createdAt: string
  updatedAt: string
}

// ── Template packs (per-industry template catalogs, installed on demand) ─────

/** A template as it ships inside a pack: a Design without identity/timestamps. */
export type PackDesign = Omit<Design, 'id' | 'createdAt' | 'updatedAt'>

export interface PackTemplate {
  key: string
  name: string
  description?: string
  tags?: string[]
  design: PackDesign
}

export interface TemplatePack {
  formatVersion: 1
  category: string
  name: string
  description: string
  icon: string
  version: string
  templates: PackTemplate[]
}

export interface PackRegistryEntry {
  category: string
  name: string
  description: string
  icon: string
  version: string
  templateCount: number
  /** Relative to the registry URL, e.g. "restaurants.json". */
  file: string
}

/** Recorded in db.json when the operator installs a category. The pack body
 *  lives in <userData>/template-packs/<category>.json, not in the db. */
export interface InstalledPack {
  category: string
  version: string
  templateCount: number
  installedAt: string
}

export interface AppDB {
  content: ContentItem[]
  devices: Device[]
  projects: Project[]
  deviceGroups: DeviceGroup[]
  templates: Template[]
  designs: Design[]
  installedPacks: InstalledPack[]
  settings: AppSettings
}
