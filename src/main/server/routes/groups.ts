import { Router } from 'express'
import { WebSocket } from 'ws'
import { v4 as uuid } from 'uuid'
import type { JsonDB } from '../database'

// Chip colours offered to new groups, cycled in order so the first few groups
// are always visually distinct.
const PALETTE = ['#3b82f6', '#f97316', '#10b981', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#ef4444']

const MAX_NAME = 60
// Colours are interpolated into inline styles in the renderer, so only accept a
// plain 6-digit hex — never free text.
const HEX = /^#[0-9a-fA-F]{6}$/

export function createGroupsRouter(db: JsonDB, tvClients: Map<string, WebSocket>) {
  const router = Router()

  const isOnline = (id: string) => {
    const ws = tvClients.get(id)
    return !!ws && ws.readyState === WebSocket.OPEN
  }

  function withCounts(groupId: string) {
    const devices = db.getDevicesByGroupId(groupId)
    return {
      deviceCount: devices.length,
      onlineCount: devices.filter(d => isOnline(d.id)).length,
    }
  }

  /** Sends a message to every online device in the group. */
  function sendToGroup(groupId: string, msg: object) {
    const devices = db.getDevicesByGroupId(groupId)
    const data = JSON.stringify(msg)
    let sent = 0
    devices.forEach(d => {
      const ws = tvClients.get(d.id)
      if (ws && ws.readyState === WebSocket.OPEN) { ws.send(data); sent++ }
    })
    return { sent, total: devices.length, offline: devices.length - sent }
  }

  // GET /api/groups
  router.get('/', (_req, res) => {
    const groups = db.getAllGroups().map(g => ({ ...g, ...withCounts(g.id) }))
    res.json({ groups })
  })

  // POST /api/groups
  router.post('/', (req, res) => {
    const { name, color } = req.body as { name?: string; color?: string }
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) { res.status(400).json({ error: 'Group name is required' }); return }
    if (trimmed.length > MAX_NAME) { res.status(400).json({ error: `Group name must be ${MAX_NAME} characters or fewer` }); return }
    if (color !== undefined && !HEX.test(color)) { res.status(400).json({ error: 'Colour must be a hex value like #3b82f6' }); return }

    const existing = db.getAllGroups()
    if (existing.some(g => g.name.toLowerCase() === trimmed.toLowerCase())) {
      res.status(409).json({ error: 'A group with that name already exists' })
      return
    }

    const now = new Date().toISOString()
    const group = db.insertGroup({
      id: uuid(),
      name: trimmed,
      color: color || PALETTE[existing.length % PALETTE.length],
      orderIndex: existing.length,
      createdAt: now,
      updatedAt: now,
    })
    res.status(201).json({ ...group, deviceCount: 0, onlineCount: 0 })
  })

  // PUT /api/groups/:id  (rename / recolour)
  router.put('/:id', (req, res) => {
    const { name, color } = req.body as { name?: string; color?: string }
    const updates: { name?: string; color?: string } = {}

    if (name !== undefined) {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (!trimmed) { res.status(400).json({ error: 'Group name is required' }); return }
      if (trimmed.length > MAX_NAME) { res.status(400).json({ error: `Group name must be ${MAX_NAME} characters or fewer` }); return }
      const clash = db.getAllGroups().some(
        g => g.id !== req.params.id && g.name.toLowerCase() === trimmed.toLowerCase()
      )
      if (clash) { res.status(409).json({ error: 'A group with that name already exists' }); return }
      updates.name = trimmed
    }
    if (color !== undefined) {
      if (!HEX.test(color)) { res.status(400).json({ error: 'Colour must be a hex value like #3b82f6' }); return }
      updates.color = color
    }

    const updated = db.updateGroup(req.params.id, updates)
    if (!updated) { res.status(404).json({ error: 'Group not found' }); return }
    res.json({ ...updated, ...withCounts(updated.id) })
  })

  // DELETE /api/groups/:id  (devices survive; they just leave the group)
  router.delete('/:id', (req, res) => {
    if (!db.deleteGroup(req.params.id)) { res.status(404).json({ error: 'Group not found' }); return }
    res.json({ ok: true })
  })

  // GET /api/groups/:id/devices
  router.get('/:id/devices', (req, res) => {
    if (!db.getGroupById(req.params.id)) { res.status(404).json({ error: 'Group not found' }); return }
    const devices = db.getDevicesByGroupId(req.params.id).map(d => ({
      ...d,
      status: isOnline(d.id) ? 'online' : 'offline',
    }))
    res.json({ devices })
  })

  // POST /api/groups/:id/push  (one content item to every online TV in the group)
  router.post('/:id/push', (req, res) => {
    const group = db.getGroupById(req.params.id)
    if (!group) { res.status(404).json({ error: 'Group not found' }); return }

    const { contentId } = req.body as { contentId?: string }
    const item = contentId ? db.getContentById(contentId) : undefined
    if (!item) { res.status(404).json({ error: 'Content not found' }); return }

    const result = sendToGroup(group.id, { type: 'manual_push', content: item })
    if (result.total === 0) { res.status(400).json({ error: 'This group has no devices yet' }); return }
    if (result.sent === 0) { res.status(503).json({ error: 'No devices in this group are online' }); return }
    res.json({ ok: true, ...result })
  })

  // POST /api/groups/:id/push-project
  router.post('/:id/push-project', (req, res) => {
    const group = db.getGroupById(req.params.id)
    if (!group) { res.status(404).json({ error: 'Group not found' }); return }

    const { projectId } = req.body as { projectId?: string }
    const project = projectId ? db.getProjectById(projectId) : undefined
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }

    const items = db.getContentByProjectId(project.id)
    if (items.length === 0) { res.status(400).json({ error: 'Project has no content items' }); return }

    const result = sendToGroup(group.id, { type: 'push_project', project, items })
    if (result.total === 0) { res.status(400).json({ error: 'This group has no devices yet' }); return }
    if (result.sent === 0) { res.status(503).json({ error: 'No devices in this group are online' }); return }
    res.json({ ok: true, count: items.length, ...result })
  })

  return router
}
