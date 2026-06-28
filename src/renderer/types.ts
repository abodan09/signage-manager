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

declare global {
  interface Window {
    electronAPI: {
      getServerUrl: () => Promise<string>
      openExternal: (url: string) => Promise<void>
    }
  }
}
