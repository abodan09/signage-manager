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

  /** POST /api/apps/connections/microsoft/signin — open a sign-in window.
   *
   *  Returns 202 straight away and does not wait. Signing in to Microsoft takes
   *  as long as the operator takes, which with MFA on a phone can be minutes;
   *  holding an Express request open for that would tie up a socket and time
   *  out in the browser long before the person finished. The renderer polls
   *  GET /connections to learn how it went. */
  router.post('/connections/:provider/signin', (req, res) => {
    if (req.params.provider === 'onedrive') { signInOneDrive(req, res); return }
    if (req.params.provider !== 'microsoft') {
      res.status(404).json({ error: 'That service does not support signing in here.' }); return
    }
    const url = String((req.body as { url?: unknown })?.url ?? '').trim()
    if (!/^https:\/\/[^\s<>"']+$/i.test(url)) {
      res.status(400).json({ error: 'Enter the SharePoint page address first, then sign in.' })
      return
    }

    res.status(202).json({ ok: true })

    // Required lazily and after responding: this pulls in Electron, which the
    // test harness does not have.
    void (async () => {
      try {
        const { signIn } = require('../apps/sharepoint/session') as typeof import('../apps/sharepoint/session')
        const result = await signIn(url)
        if (!result.signedIn) return
        apps.setConnection({
          provider: 'microsoft',
          accountName: result.host,
          // No token: this connection is a browser session in a private
          // partition, not an OAuth grant. The field is required by the shared
          // shape, and storing '' here buys the whole existing connection UI,
          // the needsConnection badge, and provider invalidation for free.
          accessToken: '',
          connectedAt: new Date().toISOString(),
          meta: { kind: 'session', partition: 'persist:sharepoint' },
        })
        broadcast({ type: 'playlist_update' })
      } catch (e: unknown) {
        console.warn('[apps] microsoft sign-in failed:', e instanceof Error ? e.message : e)
      }
    })()
  })

  /** POST /api/apps/connections/:provider/key — store a pasted credential.
   *
   *  Not every provider can be signed into. Google Drive is read with an API
   *  key the operator makes in their own Google account, because the scope that
   *  would let us sign in is one Google classifies as restricted — an annual
   *  paid security assessment, or a hundred-user cap for the life of the
   *  product. The key still belongs in connections.json rather than in the
   *  instance config: it is a credential, and config gets copied around. */
  router.post('/connections/:provider/key', (req, res) => {
    const provider = req.params.provider
    const key = String((req.body as { key?: unknown })?.key ?? '').trim()

    if (provider === 'googledrive') {
      if (!/^[A-Za-z0-9_-]{20,120}$/.test(key)) {
        res.status(400).json({ error: 'That does not look like a Google API key.' }); return
      }
      apps.setConnection({
        provider,
        accountName: `Key …${key.slice(-6)}`,
        accessToken: key,
        connectedAt: new Date().toISOString(),
        meta: { kind: 'apiKey' },
      })
    } else if (provider === 'onedrive') {
      // A client id, not a secret — it identifies the registration and is meant
      // to be public. It is stored as a 'pending' connection: something is on
      // file, but the operator has not signed in yet, so nothing can be fetched.
      if (!/^[0-9a-fA-F-]{36}$/.test(key)) {
        res.status(400).json({
          error: 'That does not look like an application (client) ID. It is a 36-character id like 11111111-2222-3333-4444-555555555555.',
        }); return
      }
      apps.setConnection({
        provider,
        accountName: 'Not signed in',
        accessToken: '',
        connectedAt: new Date().toISOString(),
        meta: { kind: 'pending', clientId: key },
      })
    } else {
      res.status(404).json({ error: 'That service does not take a key.' }); return
    }

    broadcast({ type: 'playlist_update' })
    res.json({ ok: true })
  })

  /** OneDrive's sign-in: a real OAuth flow, in the operator's own browser.
   *
   *  Not an Electron window. Microsoft tolerates embedded browsers, but a
   *  tenant with Conditional Access will refuse one, and the system browser
   *  already holds the sign-in the operator is used to. Returns 202 and lets
   *  the renderer poll, because a person with a phone in their hand is slow. */
  function signInOneDrive(_req: import('express').Request, res: import('express').Response) {
    const conn = apps.getConnection('onedrive')
    const clientId = String(conn?.meta?.clientId ?? '')
    if (!clientId) {
      res.status(400).json({ error: 'Add your application (client) ID first.' }); return
    }

    res.status(202).json({ ok: true })

    void (async () => {
      try {
        const { signIn } = require('../oauth/entra') as typeof import('../oauth/entra')
        // Required lazily and after responding — the test harness has no Electron.
        const { shell } = require('electron') as typeof import('electron')
        const tokens = await signIn(clientId, url => { void shell.openExternal(url) })
        apps.setConnection({
          provider: 'onedrive',
          accountName: 'Signed in',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          connectedAt: new Date().toISOString(),
          meta: { kind: 'oauth', clientId },
        })
        broadcast({ type: 'playlist_update' })
      } catch (e: unknown) {
        console.warn('[apps] onedrive sign-in failed:', e instanceof Error ? e.message : e)
      }
    })()
  }

  // DELETE /api/apps/connections/:provider — sign out
  router.delete('/connections/:provider', async (req, res) => {
    if (!apps.clearConnection(req.params.provider)) {
      res.status(404).json({ error: 'No account is connected for that service.' }); return
    }
    // Dropping the stored record alone would be a lie: the cookie jar would
    // still be there and every capture would keep working.
    if (req.params.provider === 'microsoft') {
      try {
        const { signOut } = require('../apps/sharepoint/session') as typeof import('../apps/sharepoint/session')
        await signOut()
      } catch { /* no Electron, or nothing stored */ }
    }
    broadcast({ type: 'playlist_update' })
    res.json({ ok: true })
  })

  return router
}
