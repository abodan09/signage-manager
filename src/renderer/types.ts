export type ContentType = 'image' | 'video' | 'html' | 'text' | 'design'
export type ScheduleMode = 'loop' | 'scheduled' | 'manual'
export type TextPosition = 'center' | 'top' | 'bottom' | 'ticker'

export interface ContentItem {
  id: string
  name: string
  type: ContentType
  filePath?: string
  fileName?: string
  mimeType?: string
  htmlUrl?: string
  designId?: string
  textContent?: string
  textBgColor?: string
  textFgColor?: string
  textFontSize?: number
  textPosition?: TextPosition
  overlayOpacity?: number   // 0–100, default 85
  projectId?: string
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

export interface Project {
  id: string
  name: string
  description?: string
  durationSeconds: number
  scheduleMode: ScheduleMode
  scheduleStartTime?: string
  scheduleEndTime?: string
  scheduleDays?: string[]
  isActive: boolean
  orderIndex: number
  createdAt: string
  updatedAt: string
  items?: ContentItem[]  // populated by GET /api/projects
}

export type PairingState = 'legacy' | 'unpaired' | 'paired'

export interface Device {
  id: string
  name: string
  ipAddress?: string
  lastSeen?: string
  status: 'online' | 'offline'
  registeredAt: string
  groupIds?: string[]
  pairingState?: PairingState
  paired?: boolean
  platform?: string
  playerVersion?: string
  pairedAt?: string
  templateId?: string
}

export interface PendingPairRequest {
  userCode: string
  ip: string
  platform: string
  playerVersion?: string
  suggestedName?: string
  requestedAt: string
  expiresAt: string
}

export interface ServerSettings {
  serverId: string
  pairingMode: 'open' | 'required'
  legacyCount: number
  unpairedCount: number
  pairedCount: number
}

export type PresetId =
  | 'fullscreen' | 'fullscreen-ticker' | 'lower-third'
  | 'branded-frame' | 'welcome-lobby' | 'portrait-poster'

export interface Theme {
  bgColor: string
  brandColor: string
  textColor: string
  bandColor: string
  bandOpacity: number
  fontStack: 'sans' | 'sans-narrow' | 'serif' | 'mono'
  fontScale: number
  logoPath?: string
  showLogo: boolean
  showClock: boolean
  clockFormat: '12h' | '24h'
  showClockDate: boolean
  tickerEnabled: boolean
  transitionMs: number
}

export interface Template {
  id: string
  name: string
  preset: PresetId
  theme: Theme
  createdAt: string
  updatedAt: string
  builtin?: boolean
}

export interface PresetInfo {
  id: PresetId
  name: string
  description: string
  orientation: 'landscape' | 'portrait' | 'any'
}

export interface DeviceGroup {
  id: string
  name: string
  color: string
  orderIndex: number
  createdAt: string
  updatedAt: string
  templateId?: string
  // populated by GET /api/groups
  deviceCount?: number
  onlineCount?: number
}

// ── Designs (Designer documents) — mirrors src/main/server/types.ts ──────────

export type SceneFontId =
  | 'sans' | 'sans-narrow' | 'serif' | 'mono'
  | 'inter' | 'oswald' | 'bebas' | 'playfair' | 'pacifico' | 'roboto-slab'

export type SceneElementType = 'text' | 'shape' | 'image' | 'qr' | 'widget'
export type ShapeKind =
  | 'rect' | 'ellipse' | 'triangle' | 'line'
  | 'triangle-down' | 'diamond' | 'pentagon' | 'hexagon' | 'star' | 'burst'
  | 'arrow-right' | 'arrow-left' | 'chevron' | 'banner' | 'shield' | 'badge'
export type QrKind =
  | 'url' | 'text' | 'email' | 'phone' | 'sms' | 'wifi'
  | 'whatsapp' | 'facebook' | 'instagram' | 'x' | 'appstore'
export type WidgetKind = 'clock' | 'date' | 'weather' | 'scroll'
export type SceneAlign = 'left' | 'center' | 'right'
export type SceneVAlign = 'top' | 'middle' | 'bottom'
export type SceneFit = 'contain' | 'cover' | 'fill'

export interface SceneElementBase {
  id: string
  type: SceneElementType
  name?: string
  x: number
  y: number
  w: number
  h: number
  rotation: number
  opacity: number
  locked?: boolean
}

export interface SceneShadow { color: string; blur: number; x: number; y: number; opacity: number }
export interface SceneGradient { from: string; to: string; angle: number }
export interface SceneOutline { color: string; width: number }

export interface TextElement extends SceneElementBase {
  type: 'text'
  shadow?: SceneShadow | null
  outline?: SceneOutline | null
  text: string
  font: SceneFontId
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  align: SceneAlign
  valign: SceneVAlign
  color: string
  lineHeight: number
  letterSpacing: number
  bgColor: string | null
  bgOpacity: number
  radius: number
}

export interface ShapeElement extends SceneElementBase {
  type: 'shape'
  kind: ShapeKind
  shadow?: SceneShadow | null
  gradient?: SceneGradient | null
  fill: string | null
  fillOpacity: number
  stroke: string | null
  strokeWidth: number
  radius: number
}

export interface ImageElement extends SceneElementBase {
  type: 'image'
  shadow?: SceneShadow | null
  src: string | null
  fit: SceneFit
  radius: number
}

export interface QrElement extends SceneElementBase {
  type: 'qr'
  data: string
  kind?: QrKind
  fields?: Record<string, string>
  fg: string
  bg: string | null
}

export interface WidgetElement extends SceneElementBase {
  type: 'widget'
  kind: WidgetKind
  config: Record<string, unknown>
  font: SceneFontId
  fontSize: number
  bold: boolean
  color: string
  align: SceneAlign
  bgColor: string | null
  bgOpacity: number
  radius: number
}

export type SceneElement = TextElement | ShapeElement | ImageElement | QrElement | WidgetElement

export interface SceneBackground {
  color: string
  gradient?: { from: string; to: string; angle: number }
  imagePath?: string
  imageFit?: SceneFit
}

export interface Design {
  id: string
  name: string
  category?: string
  templateKey?: string
  width: number
  height: number
  background: SceneBackground
  elements: SceneElement[]
  /** Saved by the operator as a starting point for future designs. */
  isTemplate?: boolean
  createdAt: string
  updatedAt: string
  /** Added by GET /api/designs — true when a playlist item shows this design. */
  published?: boolean
}

// ── Template packs ──────────────────────────────────────────────────────────

export interface PackTemplate {
  key: string
  category: string
  name: string
  description?: string
  tags?: string[]
  design: Omit<Design, 'id' | 'createdAt' | 'updatedAt'>
}

export interface PackCategory {
  category: string
  name: string
  description: string
  icon: string
  version: string
  templateCount: number
  file: string
  installed: boolean
  installedVersion?: string
  updateAvailable: boolean
  availableOffline: boolean
}

// ── Apps — mirrors src/main/server/apps/types.ts ─────────────────────────────

export type AppFieldType =
  | 'text' | 'textarea' | 'url' | 'number' | 'select' | 'color'
  | 'checkbox' | 'slider' | 'connection' | 'note' | 'image' | 'zones'

export interface AppField {
  key: string
  label: string
  type: AppFieldType
  help?: string
  placeholder?: string
  required?: boolean
  default?: unknown
  options?: Array<{ value: string; label: string; hint?: string }>
  min?: number
  max?: number
  step?: number
  marks?: string[]
  maxLength?: number
  provider?: string
  showIf?: { key: string; equals: Array<string | number | boolean> }
  advanced?: boolean
}

export interface AppDefinitionInfo {
  id: string
  name: string
  icon: string
  description: string
  category: 'social' | 'media' | 'information' | 'productivity' | 'utility'
  provider?: string
  defaultDuration: number
  fields: AppField[]
}

export interface AppInstanceInfo {
  id: string
  appId: string
  appName: string
  appIcon: string
  name: string
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
  needsConnection: boolean
  lastFetchedAt?: string
  lastError?: string
  published?: boolean
}

export interface AppConnectionInfo {
  provider: string
  accountName?: string
  accountId?: string
  connectedAt: string
  expiresAt?: number
  expired: boolean
}

export interface UpdateInfo {
  available: boolean
  version?: string
  currentVersion: string
  downloadUrl?: string
  releasePageUrl: string
  releaseNotes?: string
}

declare global {
  interface Window {
    electronAPI: {
      getServerUrl:     () => Promise<string>
      getLanUrl:        () => Promise<string>
      openExternal:     (url: string) => Promise<void>
      getVersion:       () => Promise<string>
      trackEvent:       (name: string, props?: Record<string, unknown>) => void
      getTelemetryStatus: () => Promise<{ enabled: boolean; installId: string }>
      setTelemetryEnabled: (enabled: boolean) => Promise<void>
      checkForUpdates:  () => Promise<UpdateInfo>
      installUpdate:    (url: string) => Promise<void>
      openReleaseUrl:   (url: string) => Promise<void>
      onMenuEvent:      (cb: (event: string, payload?: any) => void) => void
      onUpdateProgress: (cb: (pct: number) => void) => void
      onUpdateError:    (cb: (msg: string) => void) => void
    }
  }
}
