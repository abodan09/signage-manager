import { Router } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import type { JsonDB } from '../database'

export function createDevicesRouter(
  db: JsonDB,
  _wss: WebSocketServer,
  tvClients: Map<string, WebSocket>,
) {
  const router = Router()

  // GET /api/devices
  router.get('/', (_req, res) => {
    const devices = db.getAllDevices().map(d => ({
      ...d,
      status: tvClients.has(d.id) ? 'online' : 'offline',
    }))
    res.json({ devices })
  })

  // POST /api/devices/register  (called by TV player on connect)
  router.post('/register', (req, res) => {
    const { id, name, ipAddress } = req.body as { id: string; name?: string; ipAddress?: string }
    if (!id) { res.status(400).json({ error: 'id required' }); return }

    const now = new Date().toISOString()
    const existing = db.getDeviceById(id)
    const device = db.upsertDevice({
      id,
      name: name ?? existing?.name ?? `TV-${id.slice(0, 6)}`,
      ipAddress: ipAddress ?? existing?.ipAddress,
      lastSeen: now,
      status: 'online',
      registeredAt: existing?.registeredAt ?? now,
      // upsert replaces the whole record — carry membership over or a TV would
      // silently fall out of its groups every time it reconnects.
      groupIds: existing?.groupIds ?? [],
    })
    res.json(device)
  })

  // PATCH /api/devices/:id  (rename and/or set group membership)
  router.patch('/:id', (req, res) => {
    const { name, groupIds } = req.body as { name?: string; groupIds?: string[] }

    // Only touch the fields actually supplied: a groups-only PATCH used to
    // write `name: undefined` and wipe the device's name.
    if (name !== undefined) {
      const trimmed = name.trim()
      if (!trimmed) { res.status(400).json({ error: 'Device name is required' }); return }
      if (!db.updateDevice(req.params.id, { name: trimmed })) {
        res.status(404).json({ error: 'Not found' }); return
      }
    }

    if (groupIds !== undefined) {
      if (!Array.isArray(groupIds) || groupIds.some(g => typeof g !== 'string')) {
        res.status(400).json({ error: 'groupIds must be an array of group ids' }); return
      }
      if (!db.setDeviceGroups(req.params.id, groupIds)) {
        res.status(404).json({ error: 'Not found' }); return
      }
    }

    const updated = db.getDeviceById(req.params.id)
    if (!updated) { res.status(404).json({ error: 'Not found' }); return }
    res.json(updated)
  })

  // DELETE /api/devices/:id
  router.delete('/:id', (req, res) => {
    const deleted = db.deleteDevice(req.params.id)
    if (!deleted) { res.status(404).json({ error: 'Not found' }); return }
    res.json({ ok: true })
  })

  // POST /api/devices/:id/push  (push one content item manually to a specific TV)
  router.post('/:id/push', (req, res) => {
    const ws = tvClients.get(req.params.id)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      res.status(503).json({ error: 'Device not connected' })
      return
    }
    const { contentId } = req.body as { contentId: string }
    const item = db.getContentById(contentId)
    if (!item) { res.status(404).json({ error: 'Content not found' }); return }

    ws.send(JSON.stringify({ type: 'manual_push', content: item }))
    res.json({ ok: true })
  })

  // POST /api/devices/:id/push-project  (push all project items to a specific TV)
  router.post('/:id/push-project', (req, res) => {
    const ws = tvClients.get(req.params.id)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      res.status(503).json({ error: 'Device not connected' })
      return
    }
    const { projectId } = req.body as { projectId: string }
    const project = db.getProjectById(projectId)
    if (!project) { res.status(404).json({ error: 'Project not found' }); return }

    const items = db.getContentByProjectId(projectId)
    if (items.length === 0) { res.status(400).json({ error: 'Project has no content items' }); return }

    ws.send(JSON.stringify({ type: 'push_project', project, items }))
    res.json({ ok: true, count: items.length })
  })

  return router
}
