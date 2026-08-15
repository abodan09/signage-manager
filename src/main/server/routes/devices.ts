import { Router } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import type { JsonDB } from '../database'
import type { DevicePlatform } from '../types'
import { publicDevice, publicDevices } from './_serialize'
import { sha256 } from '../pairing'

export function createDevicesRouter(
  db: JsonDB,
  _wss: WebSocketServer,
  tvClients: Map<string, WebSocket>,
) {
  const router = Router()

  const bearer = (req: any): string => {
    const h = String(req.headers?.authorization ?? '')
    return h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  }
  const asPlatform = (v: unknown): DevicePlatform | undefined => {
    const list: DevicePlatform[] = ['android', 'webos', 'tizen', 'browser', 'unknown']
    return typeof v === 'string' && list.includes(v as DevicePlatform) ? (v as DevicePlatform) : undefined
  }

  function evict(deviceId: string) {
    const ws = tvClients.get(deviceId)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'unpaired' }))
        ws.close(4401, 'unpaired')
      } catch { /* already closing */ }
    }
  }

  // GET /api/devices
  router.get('/', (_req, res) => {
    const devices = publicDevices(db.getAllDevices()).map(d => ({
      ...d,
      status: tvClients.has(d.id) ? 'online' : 'offline',
    }))
    res.json({ devices })
  })

  // POST /api/devices/register  (called by TV player on connect)
  router.post('/register', (req, res) => {
    const { id, name, ipAddress, platform, playerVersion } =
      (req.body ?? {}) as { id?: string; name?: string; ipAddress?: string; platform?: unknown; playerVersion?: unknown }

    const now = new Date().toISOString()
    const token = bearer(req)
    const mode = db.getSettings().pairingMode
    const patch = {
      lastSeen: now,
      status: 'online' as const,
      ipAddress: ipAddress ?? String(req.socket.remoteAddress ?? '') ?? undefined,
      platform: asPlatform(platform),
      playerVersion: typeof playerVersion === 'string' ? playerVersion.slice(0, 32) : undefined,
    }

    // A paired screen is identified by its token, never by the id it claims.
    if (token) {
      const device = db.getDeviceByTokenHash(sha256(token))
      if (!device) { res.status(401).json({ error: 'unauthorized', reason: 'unknown_token' }); return }
      res.json(publicDevice(db.updateDevice(device.id, patch)!))
      return
    }

    if (!id) { res.status(400).json({ error: 'id required' }); return }
    const existing = db.getDeviceById(id)

    if (mode === 'required' && existing?.pairingState !== 'legacy') {
      res.status(401).json({ error: 'unauthorized', reason: 'pairing_required' }); return
    }

    // Existing records go through a partial merge. upsertDevice replaces the
    // whole record, which has already silently wiped groupIds once — with a
    // token on the record it would de-pair every screen on every reconnect.
    if (existing) {
      res.json(publicDevice(db.updateDevice(id, { ...patch, name: name ?? existing.name })!))
      return
    }

    const device = db.upsertDevice({
      id,
      name: name ?? `TV-${id.slice(0, 6)}`,
      ipAddress: patch.ipAddress,
      lastSeen: now,
      status: 'online',
      registeredAt: now,
      groupIds: [],
      pairingState: 'unpaired',
      platform: patch.platform,
      playerVersion: patch.playerVersion,
    })
    res.json(publicDevice(device))
  })

  // POST /api/devices/:id/revoke  — un-pair but keep the screen's identity
  router.post('/:id/revoke', (req, res) => {
    const device = db.getDeviceById(req.params.id)
    if (!device) { res.status(404).json({ error: 'Not found' }); return }
    evict(device.id)
    const updated = db.clearDeviceToken(device.id)
    res.json({ ok: true, device: updated ? publicDevice(updated) : null })
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
    res.json(publicDevice(updated))
  })

  // DELETE /api/devices/:id
  router.delete('/:id', (req, res) => {
    // Tell the screen before the record goes, so it falls back to a pairing
    // code instead of sitting on stale content forever.
    evict(req.params.id)
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
