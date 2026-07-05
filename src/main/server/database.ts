import fs from 'fs'
import path from 'path'
import type { AppDB, ContentItem, Device, Project } from './types'

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
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'))
        // Migrate: add projects array if missing (existing installs)
        if (!raw.projects) raw.projects = []
        return raw
      }
    } catch {
      // corrupt file – start fresh
    }
    return { content: [], devices: [], projects: [] }
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

  getContentByProjectId(projectId: string): ContentItem[] {
    return this.data.content.filter(c => c.projectId === projectId)
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

  // ── Projects ───────────────────────────────────────────────────────────────

  getAllProjects(): Project[] {
    return [...this.data.projects].sort((a, b) => a.orderIndex - b.orderIndex)
  }

  getProjectById(id: string): Project | undefined {
    return this.data.projects.find(p => p.id === id)
  }

  insertProject(project: Project): Project {
    this.data.projects.push(project)
    this.save()
    return project
  }

  updateProject(id: string, updates: Partial<Project>): Project | null {
    const idx = this.data.projects.findIndex(p => p.id === id)
    if (idx === -1) return null
    this.data.projects[idx] = { ...this.data.projects[idx], ...updates, updatedAt: new Date().toISOString() }
    this.save()
    return this.data.projects[idx]
  }

  deleteProject(id: string): boolean {
    const before = this.data.projects.length
    this.data.projects = this.data.projects.filter(p => p.id !== id)
    // Detach content items from deleted project
    this.data.content.forEach(c => {
      if (c.projectId === id) delete c.projectId
    })
    const deleted = this.data.projects.length < before
    if (deleted) this.save()
    return deleted
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
