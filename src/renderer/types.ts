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

export interface Device {
  id: string
  name: string
  ipAddress?: string
  lastSeen?: string
  status: 'online' | 'offline'
  registeredAt: string
}

export interface UpdateInfo {
  available: boolean
  version?: string
  currentVersion: string
  downloadUrl?: string
  releasePageUrl: string
}

declare global {
  interface Window {
    electronAPI: {
      getServerUrl:     () => Promise<string>
      openExternal:     (url: string) => Promise<void>
      getVersion:       () => Promise<string>
      checkForUpdates:  () => Promise<UpdateInfo>
      installUpdate:    (url: string) => Promise<void>
      openReleaseUrl:   (url: string) => Promise<void>
      onMenuEvent:      (cb: (event: string, payload?: any) => void) => void
      onUpdateProgress: (cb: (pct: number) => void) => void
      onUpdateError:    (cb: (msg: string) => void) => void
    }
  }
}
