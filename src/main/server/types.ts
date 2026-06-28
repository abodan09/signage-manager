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
  // display
  durationSeconds: number
  // scheduling
  scheduleMode: ScheduleMode
  scheduleStartTime?: string  // "09:00"
  scheduleEndTime?: string    // "18:00"
  scheduleDays?: string[]     // ["mon","tue","wed","thu","fri","sat","sun"]
  // meta
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

export interface AppDB {
  content: ContentItem[]
  devices: Device[]
}
