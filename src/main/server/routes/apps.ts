import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { WebSocket } from 'ws'
import type { JsonDB } from '../database'
import type { AppStore } from '../apps/store'
import { getApp } from '../apps/registry'
import { publicDefinition, sanitizeAppConfig } from '../apps/schema'
import type { ContentItem } from '../types'

export function createAppsRouter(db: JsonDB, apps: AppStore, tvClients: Map<string, WebSocket>, getLanUrl: () => string) {
  const router = Router()

  function broadcast(msg: object) {
    const data = JSON.stringify(msg)
    tvClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    })
  }

  /** A change to an app's settings should reach the wall now, not at the next
   *  refresh — the operator is usually standing in front of the screen. */
  function notifyScreens(instanceId: string) {
    if (db.getContentByAppInstanceId(instanceId).length) broadcast({ type: 'playlist_update' })
  }

  // GET /api/apps — the Add App picker
  router.get('/', (_req, res) => {
    res.json({
      apps: apps.definitions().map(publicDefinition),
      connections: apps.publicConnections(),
    })
  })

  // GET /api/apps/instances
  router.get('/instances', (_req, res) => {
    const instances = db.getAllAppInstances().map(i => apps.publicInstance(i))
    const published = new Set(db.getAllContent().filter(c => c.appInstanceId).map(c => c.appInstanceId))
    res.json({ instances: instances.map(i => ({ ...i, published: published.has(i.id) })) })
  })

  // GET /api/apps/instances/:id
  router.get('/instances/:id', (req, res) => {
    const inst = db.getAppInstanceById(req.params.id)
    if (!inst) { res.status(404).json({ error: 'App not found' }); return }
    res.json({ instance: apps.publicInstance(inst) })
  })

  // POST /api/apps/instances
  router.post('/instances', async (req, res) => {
    const { appId, name, config } = (req.body ?? {}) as Record<string, unknown>
    const def = getApp(String(appId))
    if (!def) { res.status(400).json({ error: 'Unknown app' }); return }

    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed) { res.status(400).json({ error: 'Give this app a name' }); return }
    if (trimmed.length > 80) { res.status(400).json({ error: 'Name must be 80 characters or fewer' }); return }

    const clean = sanitizeAppConfig(def, config)
    if (!clean.ok) { res.status(400).json({ error: clean.error }); return }

    const now = new Date().toISOString()
    let created = db.insertAppInstance({
      id: uuid(), appId: def.id, name: trimmed, config: clean.config, createdAt: now, updatedAt: now,
    })
    // Fetch straight away so Preview shows real content rather than a spinner.
    await apps.refresh(created, getLanUrl(), true)

    // Some apps learn a better name than the operator could type — a video's
    // own title. Only adopted when they left the app's default name alone,
    // so a deliberate name is never overwritten.
    if (created.name === def.name) {
      const suggested = apps.suggestName(created, getLanUrl())
      if (suggested) created = db.updateAppInstance(created.id, { name: suggested }) ?? created
    }

    res.status(201).json({ instance: apps.publicInstance(created) })
  })

  // PUT /api/apps/instances/:id
  router.put('/instances/:id', async (req, res) => {
    const existing = db.getAppInstanceById(req.params.id)
    if (!existing) { res.status(404).json({ error: 'App not found' }); return }
    const def = getApp(existing.appId)
    if (!def) { res.status(400).json({ error: 'This app is no longer available' }); return }

    const { name, config } = (req.body ?? {}) as Record<string, unknown>
    const updates: Partial<typeof existing> = {}

    if (name !== undefined) {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (!trimmed) { res.status(400).json({ error: 'Give this app a name' }); return }
      updates.name = trimmed.slice(0, 80)
    }
    if (config !== undefined) {
      const clean = sanitizeAppConfig(def, config)
      if (!clean.ok) { res.status(400).json({ error: clean.error }); return }
      updates.config = clean.config
    }

    const updated = db.updateAppInstance(req.params.id, updates)!
    // Settings that change what is fetched (an account, a post filter) make the
    // cache wrong, not stale, so it is dropped rather than aged out.
    if (config !== undefined) {
      apps.invalidate(updated.id)
      await apps.refresh(updated, getLanUrl(), true)
    }
    notifyScreens(updated.id)
    res.json({ instance: apps.publicInstance(updated) })
  })

  // DELETE /api/apps/instances/:id
  router.delete('/instances/:id', (req, res) => {
    const result = db.deleteAppInstance(req.params.id)
    if (!result.deleted) { res.status(404).json({ error: 'App not found' }); return }
    apps.invalidate(req.params.id)
    if (result.removedContentIds.length) broadcast({ type: 'playlist_update' })
    res.json({ ok: true, removedFromPlaylist: result.removedContentIds.length })
  })

  // POST /api/apps/instances/:id/refresh — "fetch it again, now"
  router.post('/instances/:id/refresh', async (req, res) => {
    const inst = db.getAppInstanceById(req.params.id)
    if (!inst) { res.status(404).json({ error: 'App not found' }); return }
    await apps.refresh(inst, getLanUrl(), true)
    const entry = apps.getCached(inst.id)
    if (entry?.lastError) { res.status(502).json({ error: entry.lastError }); return }
    notifyScreens(inst.id)
    res.json({ ok: true, lastFetchedAt: entry ? new Date(entry.fetchedAt).toISOString() : undefined })
  })

  /** POST /api/apps/instances/:id/publish — put the app on the wall.
   *  One instance maps to at most one playlist item, so saving twice updates
   *  the entry instead of stacking duplicates. */
  router.post('/instances/:id/publish', (req, res) => {
    const inst = db.getAppInstanceById(req.params.id)
    if (!inst) { res.status(404).json({ error: 'App not found' }); return }
    const def = getApp(inst.appId)

    const body = (req.body ?? {}) as Record<string, unknown>
    const raw = Number(body.durationSeconds)
    const durationSeconds = Number.isFinite(raw) && raw >= 1 && raw <= 3600
      ? Math.round(raw)
      : (def?.defaultDuration ?? 30)
    const mode = body.scheduleMode
    const scheduleMode = mode === 'scheduled' || mode === 'manual' ? mode : 'loop'

    const existing = db.getContentByAppInstanceId(inst.id)[0]
    let item: ContentItem | null

    if (existing) {
      item = db.updateContent(existing.id, { name: inst.name, durationSeconds, scheduleMode, isActive: true })
    } else {
      const now = new Date().toISOString()
      const maxOrder = db.getAllContent().reduce((m, c) => Math.max(m, c.orderIndex), -1)
      item = db.insertContent({
        id: uuid(),
        name: inst.name,
        type: 'app',
        appInstanceId: inst.id,
        durationSeconds,
        scheduleMode,
        isActive: true,
        orderIndex: maxOrder + 1,
        createdAt: now,
        updatedAt: now,
      })
    }

    broadcast({ type: 'playlist_update' })
    res.status(existing ? 200 : 201).json({ item })
  })

  // ── connected accounts ─────────────────────────────────────────────────────

  // GET /api/apps/connections
  router.get('/connections', (_req, res) => {
    res.json({ connections: apps.publicConnections() })
  })

  // DELETE /api/apps/connections/:provider — sign out
  router.delete('/connections/:provider', (req, res) => {
    if (!apps.clearConnection(req.params.provider)) {
      res.status(404).json({ error: 'No account is connected for that service.' }); return
    }
    broadcast({ type: 'playlist_update' })
    res.json({ ok: true })
  })

  return router
}
