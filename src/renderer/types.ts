export type ContentType = 'image' | 'video' | 'html' | 'text'
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
