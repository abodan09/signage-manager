import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type { AppDB, AppSettings, ContentItem, Device, DeviceGroup, Project, ResolvedTemplate, Template } from './types'
import { builtinTemplates, DEFAULT_TEMPLATE_ID, isBuiltinId, resolveTemplate } from './templates'

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
        // Migrate: add collections missing from older installs
        if (!raw.projects) raw.projects = []
        if (!raw.deviceGroups) raw.deviceGroups = []
        if (!raw.devices) raw.devices = []
        if (!raw.templates) raw.templates = []
        if (!raw.settings) raw.settings = { serverId: randomUUID(), pairingMode: 'open' }
        if (!raw.settings.serverId) raw.settings.serverId = randomUUID()
        if (raw.settings.pairingMode !== 'required') raw.settings.pairingMode = 'open'
        if (!raw.settings.defaultTemplateId) raw.settings.defaultTemplateId = DEFAULT_TEMPLATE_ID
        // Text created before templates keeps supplying its own colours, so no
        // screen changes appearance on upgrade. New text defaults to the theme.
        raw.content.forEach((c: ContentItem) => {
          if (c.type === 'text' && !c.styleSource) c.styleSource = 'custom'
        })
        // Grandfather every screen that existed before pairing: it keeps
        // registering without a token forever, even in 'required' mode, so an
        // upgrade never blacks out a fleet. Records created from here on always
        // carry an explicit state, so this can't mislabel them later.
        raw.devices.forEach((d: Device) => { if (!d.pairingState) d.pairingState = 'legacy' })
        return raw
      }
    } catch {
      // corrupt file – start fresh
    }
    return {
      content: [], devices: [], projects: [], deviceGroups: [], templates: [],
      settings: { serverId: randomUUID(), pairingMode: 'open', defaultTemplateId: DEFAULT_TEMPLATE_ID },
    }
  }

  private save() {
    // write-then-rename so the db survives the process being killed mid-write
    // (the installer force-closes the app during auto-updates)
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
    fs.renameSync(tmp, this.filePath)
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

  // ── Device groups ──────────────────────────────────────────────────────────

  getAllGroups(): DeviceGroup[] {
    return [...this.data.deviceGroups].sort((a, b) => a.orderIndex - b.orderIndex)
  }

  getGroupById(id: string): DeviceGroup | undefined {
    return this.data.deviceGroups.find(g => g.id === id)
  }

  insertGroup(group: DeviceGroup): DeviceGroup {
    this.data.deviceGroups.push(group)
    this.save()
    return group
  }

  updateGroup(id: string, updates: Partial<DeviceGroup>): DeviceGroup | null {
    const idx = this.data.deviceGroups.findIndex(g => g.id === id)
    if (idx === -1) return null
    this.data.deviceGroups[idx] = {
      ...this.data.deviceGroups[idx],
      ...updates,
      id: this.data.deviceGroups[idx].id,
      updatedAt: new Date().toISOString(),
    }
    this.save()
    return this.data.deviceGroups[idx]
  }

  /** Deletes the group and strips its id from every device that referenced it. */
  deleteGroup(id: string): boolean {
    const before = this.data.deviceGroups.length
    this.data.deviceGroups = this.data.deviceGroups.filter(g => g.id !== id)
    const deleted = this.data.deviceGroups.length < before
    if (!deleted) return false
    this.data.devices.forEach(d => {
      if (d.groupIds?.includes(id)) d.groupIds = d.groupIds.filter(g => g !== id)
    })
    this.save()
    return true
  }

  /** Replaces a device's group membership, ignoring ids that no longer exist. */
  setDeviceGroups(deviceId: string, groupIds: string[]): Device | null {
    const device = this.data.devices.find(d => d.id === deviceId)
    if (!device) return null
    const known = new Set(this.data.deviceGroups.map(g => g.id))
    device.groupIds = [...new Set(groupIds)].filter(id => known.has(id))
    this.save()
    return device
  }

  getDevicesByGroupId(groupId: string): Device[] {
    return this.data.devices.filter(d => d.groupIds?.includes(groupId))
  }

  // ── Settings & pairing ─────────────────────────────────────────────────────

  getSettings(): AppSettings {
    return this.data.settings
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch, serverId: this.data.settings.serverId }
    this.save()
    return this.data.settings
  }

  getDeviceByTokenHash(hash: string): Device | undefined {
    if (!hash) return undefined
    return this.data.devices.find(d => d.tokenHash === hash)
  }

  /** Binds a token to a device. Partial merge — never a whole-record replace. */
  setDeviceToken(id: string, tokenHash: string): Device | null {
    return this.updateDevice(id, {
      tokenHash,
      pairingState: 'paired',
      pairedAt: new Date().toISOString(),
    })
  }

  /** Explicit removal, so the delete is intentional and everything else — the
   *  name, the groups, the registration date — survives for re-pairing. */
  clearDeviceToken(id: string): Device | null {
    const idx = this.data.devices.findIndex(d => d.id === id)
    if (idx === -1) return null
    const { tokenHash, pairedAt, ...rest } = this.data.devices[idx]
    this.data.devices[idx] = { ...rest, pairingState: 'unpaired' }
    this.save()
    return this.data.devices[idx]
  }

  /** Removes grandfathering from every pre-pairing device. */
  untrustLegacyDevices(): number {
    let changed = 0
    this.data.devices.forEach(d => {
      if (d.pairingState === 'legacy') { d.pairingState = 'unpaired'; changed++ }
    })
    if (changed) this.save()
    return changed
  }

  // ── Templates ──────────────────────────────────────────────────────────────

  /** Built-in presets first, then anything the operator created. */
  getAllTemplates(): Template[] {
    return [...builtinTemplates(), ...this.data.templates]
  }

  getTemplateById(id: string): Template | undefined {
    if (isBuiltinId(id)) return builtinTemplates().find(t => t.id === id)
    return this.data.templates.find(t => t.id === id)
  }

  insertTemplate(t: Template): Template {
    this.data.templates.push(t)
    this.save()
    return t
  }

  updateTemplate(id: string, updates: Partial<Template>): Template | null {
    const idx = this.data.templates.findIndex(t => t.id === id)
    if (idx === -1) return null
    this.data.templates[idx] = {
      ...this.data.templates[idx],
      ...updates,
      id: this.data.templates[idx].id,
      updatedAt: new Date().toISOString(),
    }
    this.save()
    return this.data.templates[idx]
  }

  /** Deleting a template detaches it everywhere so nothing points at a ghost. */
  deleteTemplate(id: string): boolean {
    if (isBuiltinId(id)) return false
    const before = this.data.templates.length
    this.data.templates = this.data.templates.filter(t => t.id !== id)
    if (this.data.templates.length === before) return false
    this.data.devices.forEach(d => { if (d.templateId === id) delete d.templateId })
    this.data.deviceGroups.forEach(g => { if (g.templateId === id) delete g.templateId })
    this.data.projects.forEach(p => { if (p.templateId === id) delete p.templateId })
    if (this.data.settings.defaultTemplateId === id) this.data.settings.defaultTemplateId = DEFAULT_TEMPLATE_ID
    this.save()
    return true
  }

  /** device → first group that has one → install default → built-in fullscreen.
   *  Templates govern presentation only, so every screen still receives the
   *  same playlist; only the frame around it differs. */
  resolveTemplateForDevice(deviceId?: string, projectTemplateId?: string): ResolvedTemplate {
    const pick = (id?: string) => (id ? this.getTemplateById(id) : undefined)

    let t = pick(projectTemplateId)
    if (!t && deviceId) {
      const device = this.getDeviceById(deviceId)
      t = pick(device?.templateId)
      if (!t && device?.groupIds?.length) {
        const groups = this.getAllGroups().filter(g => device.groupIds!.includes(g.id))
        for (const g of groups) {
          const found = pick(g.templateId)
          if (found) { t = found; break }
        }
      }
    }
    if (!t) t = pick(this.data.settings.defaultTemplateId)
    if (!t) t = this.getTemplateById(DEFAULT_TEMPLATE_ID)!
    return resolveTemplate(t)
  }

  countByPairingState(): { legacy: number; unpaired: number; paired: number } {
    const out = { legacy: 0, unpaired: 0, paired: 0 }
    this.data.devices.forEach(d => { out[d.pairingState ?? 'legacy']++ })
    return out
  }
}
