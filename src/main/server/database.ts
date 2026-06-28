import fs from 'fs'
import path from 'path'
import type { AppDB, ContentItem, Device } from './types'

export class JsonDB {
  private filePath: string
  private data: AppDB

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'db.json')
    this.data = this.load()
  }

  private load(): AppDB {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
      }
    } catch {
      // corrupt file – start fresh
    }
    return { content: [], devices: [] }
  }

  private save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  // ── Content ────────────────────────────────────────────────────────────────

  getAllContent(): ContentItem[] {
    return [...this.data.content].sort((a, b) => a.orderIndex - b.orderIndex)
  }

  getContentById(id: string): ContentItem | undefined {
    return this.data.content.find(c => c.id === id)
  }

  insertContent(item: ContentItem): ContentItem {
    this.data.content.push(item)
    this.save()
    return item
  }

  updateContent(id: string, updates: Partial<ContentItem>): ContentItem | null {
    const idx = this.data.content.findIndex(c => c.id === id)
    if (idx === -1) return null
    this.data.content[idx] = { ...this.data.content[idx], ...updates, updatedAt: new Date().toISOString() }
    this.save()
    return this.data.content[idx]
  }

  deleteContent(id: string): boolean {
    const before = this.data.content.length
    this.data.content = this.data.content.filter(c => c.id !== id)
    const deleted = this.data.content.length < before
    if (deleted) this.save()
    return deleted
  }

  reorderContent(ids: string[]) {
    ids.forEach((id, idx) => {
      const item = this.data.content.find(c => c.id === id)
      if (item) item.orderIndex = idx
    })
    this.save()
  }

  // ── Devices ────────────────────────────────────────────────────────────────

  getAllDevices(): Device[] {
    return [...this.data.devices]
  }

  getDeviceById(id: string): Device | undefined {
    return this.data.devices.find(d => d.id === id)
  }

  upsertDevice(device: Device): Device {
    const idx = this.data.devices.findIndex(d => d.id === device.id)
    if (idx === -1) {
      this.data.devices.push(device)
    } else {
      this.data.devices[idx] = device
    }
    this.save()
    return device
  }

  updateDevice(id: string, updates: Partial<Device>): Device | null {
    const idx = this.data.devices.findIndex(d => d.id === id)
    if (idx === -1) return null
    this.data.devices[idx] = { ...this.data.devices[idx], ...updates }
    this.save()
    return this.data.devices[idx]
  }

  deleteDevice(id: string): boolean {
    const before = this.data.devices.length
    this.data.devices = this.data.devices.filter(d => d.id !== id)
    const deleted = this.data.devices.length < before
    if (deleted) this.save()
    return deleted
  }
}
