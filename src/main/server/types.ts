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
}

export interface Project {
  id: string
  name: string
  description?: string
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
}

export interface AppSettings {
  /** Stable per-install id, minted once and advertised in the discovery beacon
   *  so a shell can tell "my manager moved IP" from "a different manager". */
  serverId: string
  pairingMode: 'open' | 'required'
}

export interface DeviceGroup {
  id: string
  name: string
  color: string
  orderIndex: number
  createdAt: string
  updatedAt: string
}

export interface AppDB {
  content: ContentItem[]
  devices: Device[]
  projects: Project[]
  deviceGroups: DeviceGroup[]
  settings: AppSettings
}
