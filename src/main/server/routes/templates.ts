import { Router } from 'express'
import { WebSocket } from 'ws'
import { v4 as uuid } from 'uuid'
import type { JsonDB } from '../database'
import type { PresetId } from '../types'
import { DEFAULT_TEMPLATE_ID, PRESETS, defaultTheme, isBuiltinId, resolveTemplate, sanitizeTheme } from '../templates'

export function createTemplatesRouter(db: JsonDB, tvClients: Map<string, WebSocket>) {
  const router = Router()

  /** Pushes each screen its own resolved template — a device-level assignment
   *  beats its group's, so the payload cannot be shared between sockets. */
  function pushTemplates() {
    tvClients.forEach((ws, deviceId) => {
      if (ws.readyState !== WebSocket.OPEN) return
      const template = db.resolveTemplateForDevice(deviceId)
      ws.send(JSON.stringify({ type: 'template_update', template }))
    })
  }

  // GET /api/templates — built-in presets plus anything the operator made
  router.get('/', (_req, res) => {
    res.json({
      templates: db.getAllTemplates().map(t => ({ ...t, builtin: isBuiltinId(t.id) })),
      presets: Object.values(PRESETS).map(p => ({
        id: p.id, name: p.name, description: p.description, orientation: p.orientation,
      })),
      defaultTemplateId: db.getSettings().defaultTemplateId,
    })
  })

  // GET /api/templates/:id/resolved — what a screen would actually receive
  router.get('/:id/resolved', (req, res) => {
    const t = db.getTemplateById(req.params.id)
    if (!t) { res.status(404).json({ error: 'Template not found' }); return }
    res.json({ template: resolveTemplate(t) })
  })

  // POST /api/templates
  router.post('/', (req, res) => {
    const { name, preset, theme } = (req.body ?? {}) as Record<string, unknown>
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) { res.status(400).json({ error: 'Template name is required' }); return }
    if (trimmed.length > 60) { res.status(400).json({ error: 'Template name must be 60 characters or fewer' }); return }
    if (typeof preset !== 'string' || !(preset in PRESETS)) {
      res.status(400).json({ error: 'Choose one of the built-in layouts' }); return
    }
    const clean = sanitizeTheme(theme ?? defaultTheme())
    if (!clean.ok) { res.status(400).json({ error: clean.error }); return }

    const now = new Date().toISOString()
    const created = db.insertTemplate({
      id: uuid(), name: trimmed, preset: preset as PresetId, theme: clean.theme,
      createdAt: now, updatedAt: now,
    })
    res.status(201).json(created)
  })

  // PUT /api/templates/assign — set the template for a device, group, or install.
  // MUST be declared before PUT /:id, or Express matches this path as an id.
  router.put('/assign', (req, res) => {
    const { scope, id, templateId } = (req.body ?? {}) as Record<string, unknown>
    const tid = templateId === null || templateId === undefined || templateId === '' ? undefined : String(templateId)
    if (tid && !db.getTemplateById(tid)) { res.status(404).json({ error: 'Template not found' }); return }

    if (scope === 'device') {
      if (!db.getDeviceById(String(id))) { res.status(404).json({ error: 'Screen not found' }); return }
      db.updateDevice(String(id), { templateId: tid })
    } else if (scope === 'group') {
      if (!db.getGroupById(String(id))) { res.status(404).json({ error: 'Group not found' }); return }
      db.updateGroup(String(id), { templateId: tid })
    } else if (scope === 'default') {
      db.updateSettings({ defaultTemplateId: tid || DEFAULT_TEMPLATE_ID })
    } else {
      res.status(400).json({ error: "scope must be 'device', 'group' or 'default'" }); return
    }
    pushTemplates()
    res.json({ ok: true })
  })

  // PUT /api/templates/:id
  router.put('/:id', (req, res) => {
    if (isBuiltinId(req.params.id)) {
      res.status(400).json({ error: 'Built-in layouts cannot be edited. Duplicate it first.' }); return
    }
    const existing = db.getTemplateById(req.params.id)
    if (!existing) { res.status(404).json({ error: 'Template not found' }); return }

    const { name, preset, theme } = (req.body ?? {}) as Record<string, unknown>
    const updates: Record<string, unknown> = {}
    if (name !== undefined) {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (!trimmed) { res.status(400).json({ error: 'Template name is required' }); return }
      updates.name = trimmed.slice(0, 60)
    }
    if (preset !== undefined) {
      if (typeof preset !== 'string' || !(preset in PRESETS)) {
        res.status(400).json({ error: 'Choose one of the built-in layouts' }); return
      }
      updates.preset = preset
    }
    if (theme !== undefined) {
      const clean = sanitizeTheme({ ...existing.theme, ...(theme as object) })
      if (!clean.ok) { res.status(400).json({ error: clean.error }); return }
      updates.theme = clean.theme
    }

    const updated = db.updateTemplate(req.params.id, updates)
    pushTemplates()
    res.json(updated)
  })

  // DELETE /api/templates/:id
  router.delete('/:id', (req, res) => {
    if (isBuiltinId(req.params.id)) {
      res.status(400).json({ error: 'Built-in layouts cannot be deleted.' }); return
    }
    if (!db.deleteTemplate(req.params.id)) { res.status(404).json({ error: 'Template not found' }); return }
    pushTemplates()
    res.json({ ok: true })
  })

  return router
}
