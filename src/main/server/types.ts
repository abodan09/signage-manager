export type ContentType = 'image' | 'video' | 'html' | 'text'
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

export interface AppDB {
  content: ContentItem[]
  devices: Device[]
  projects: Project[]
  deviceGroups: DeviceGroup[]
  templates: Template[]
  settings: AppSettings
}
