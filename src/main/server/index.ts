import express from 'express'
import cors from 'cors'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { WebSocketServer, WebSocket } from 'ws'
import { JsonDB } from './database'
import { createContentRouter } from './routes/content'
import { createDevicesRouter } from './routes/devices'
import { createGroupsRouter } from './routes/groups'
import { createPairRouter } from './routes/pair'
import { createPlayerRouter } from './routes/player'
import { createProjectsRouter } from './routes/projects'
import { createSettingsRouter } from './routes/settings'
import { createTemplatesRouter } from './routes/templates'
import { startDiscovery, getLocalIP } from './discovery'
import { PairingStore, sha256 } from './pairing'
import { track, setTvCountProvider } from '../telemetry'

// Feature-usage telemetry: successful mutations (and TV player loads) map to
// named events. Reads/polling are deliberately not tracked. Order matters —
// first match wins.
const FEATURE_EVENTS: Array<[string, RegExp, string]> = [
  ['POST',   /^\/api\/projects\/[^/]+\/content\/?$/,        'content_uploaded'],
  ['DELETE', /^\/api\/projects\/[^/]+\/content\/[^/]+\/?$/, 'content_deleted'],
  ['POST',   /^\/api\/projects\/?$/,                        'project_created'],
  ['PUT',    /^\/api\/projects\/[^/]+\/?$/,                 'project_updated'],
  ['DELETE', /^\/api\/projects\/[^/]+\/?$/,                 'project_deleted'],
  ['PATCH',  /^\/api\/content\/reorder\/?$/,                'content_reordered'],
  ['POST',   /^\/api\/content\/?$/,                         'content_uploaded'],
  ['PUT',    /^\/api\/content\/[^/]+\/?$/,                  'content_updated'],
  ['DELETE', /^\/api\/content\/[^/]+\/?$/,                  'content_deleted'],
  ['POST',   /^\/api\/devices\/register\/?$/,               'device_registered'],
  ['POST',   /^\/api\/devices\/[^/]+\/push\/?$/,            'push_to_device'],
  ['POST',   /^\/api\/devices\/[^/]+\/push-project\/?$/,    'push_project_to_device'],
  ['PATCH',  /^\/api\/devices\/[^/]+\/?$/,                  'device_updated'],
  ['DELETE', /^\/api\/devices\/[^/]+\/?$/,                  'device_removed'],
  ['POST',   /^\/api\/groups\/[^/]+\/push\/?$/,             'push_to_group'],
  ['POST',   /^\/api\/groups\/[^/]+\/push-project\/?$/,     'push_project_to_group'],
  ['POST',   /^\/api\/groups\/?$/,                          'group_created'],
  ['PUT',    /^\/api\/groups\/[^/]+\/?$/,                   'group_updated'],
  ['DELETE', /^\/api\/groups\/[^/]+\/?$/,                   'group_deleted'],
  // Pairing: only the operator-driven outcomes. /pair/start and /pair/poll fire
  // every few seconds per unpaired TV and would flood the pipeline.
  ['POST',   /^\/api\/pair\/approve\/?$/,                   'device_paired'],
  ['POST',   /^\/api\/devices\/[^/]+\/revoke\/?$/,          'device_revoked'],
  ['PATCH',  /^\/api\/settings\/?$/,                        'pairing_mode_changed'],
  ['POST',   /^\/api\/templates\/?$/,                       'template_created'],
  ['PUT',    /^\/api\/templates\/assign\/?$/,               'template_assigned'],
  ['PUT',    /^\/api\/templates\/[^/]+\/?$/,                'template_updated'],
  ['GET',    /^\/tv\/player\/?$/,                           'player_opened'],
]

// Endpoints a TV must reach from anywhere on the LAN. Everything else under
// /api is operator-only and must come from this PC.
const TV_OPEN: Array<[string, RegExp]> = [
  ['POST', /^\/devices\/register\/?$/],
  ['GET',  /^\/content\/active\/?$/],
  ['POST', /^\/pair\/start\/?$/],
  ['POST', /^\/pair\/poll\/?$/],
  ['GET',  /^\/health\/?$/],
  ['GET',  /^\/discovery\/?$/],
]

/** True only for requests originating from the manager app on this machine.
 *  Loopback alone is not enough — a page open in a browser on the same PC also
 *  arrives from 127.0.0.1 — so the Host check (which defeats DNS rebinding) and
 *  the Origin check sit alongside it. */
function isLocalAdmin(req: import('express').Request): boolean {
  if (!isLoopback(req.socket.remoteAddress)) return false
  const host = String(req.headers.host ?? '').split(':')[0].replace(/^\[|\]$/g, '')
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return false
  const origin = req.headers.origin
  if (origin === undefined || origin === 'null') return true   // packaged Electron
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(String(origin))
}

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

export async function startServer(userData: string, port: number, appVersion = '1.0.0'): Promise<number> {
  fs.mkdirSync(path.join(userData, 'uploads'), { recursive: true })

  const db = new JsonDB(userData)
  const uploadsDir = path.join(userData, 'uploads')
  const pairing = new PairingStore()
  pairing.startSweeper()

  const app = express()
  const server = http.createServer(app)
  const wss = new WebSocketServer({ server })

  // deviceId → WebSocket (TV clients only)
  const tvClients = new Map<string, WebSocket>()

  setTvCountProvider(() => tvClients.size)

  app.use(cors())
  app.use(express.json())
  app.use((req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) return
      const hit = FEATURE_EVENTS.find(([m, re]) => m === req.method && re.test(req.path))
      if (!hit) return
      const name = hit[2]
      track(name, name === 'player_opened' ? { remote: !isLoopback(req.socket.remoteAddress) } : undefined)
    })
    next()
  })
  // Operator-only gate. Mounted before the routers so every /api route is
  // covered by default and new endpoints are private unless explicitly opened.
  app.use('/api', (req, res, next) => {
    if (TV_OPEN.some(([m, re]) => m === req.method && re.test(req.path))) return next()
    if (isLocalAdmin(req)) return next()
    res.status(403).json({ error: 'This action can only be performed from the Signage Manager app on this PC.' })
  })

  app.use('/uploads', express.static(uploadsDir))
  app.use('/api/content', createContentRouter(db, uploadsDir, wss, tvClients))
  app.use('/api/devices', createDevicesRouter(db, wss, tvClients))
  app.use('/api/groups', createGroupsRouter(db, tvClients))
  app.use('/api/pair', createPairRouter(db, pairing, tvClients))
  app.use('/api/projects', createProjectsRouter(db, uploadsDir, wss, tvClients))
  app.use('/api/settings', createSettingsRouter(db, tvClients))
  app.use('/api/templates', createTemplatesRouter(db, tvClients))
  app.use('/tv', createPlayerRouter(appVersion))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, connectedTVs: tvClients.size })
  })

  app.get('/api/discovery', (_req, res) => {
    const s = db.getSettings()
    res.json({
      ip: getLocalIP(), port, name: 'Signage Manager', version: appVersion,
      serverId: s.serverId, pairingMode: s.pairingMode,
    })
  })

  wss.on('connection', (ws, req) => {
    // Browsers do not apply CORS to WebSockets, so without this any page the
    // operator happens to visit could open ws:// and impersonate a screen.
    // Native shells send no Origin at all, which is allowed.
    const origin = req.headers.origin
    if (origin) {
      let originHost = ''
      try { originHost = new URL(origin).host } catch { originHost = '' }
      if (originHost !== req.headers.host) { ws.close(4403, 'forbidden origin'); return }
    }

    let deviceId: string | null = null
    // A socket that never identifies itself is not a screen.
    const killTimer = setTimeout(() => { if (!deviceId) ws.close(4408, 'no register') }, 5000)

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; deviceId?: string; name?: string; token?: string }
        if (msg.type !== 'register' || deviceId) return

        const mode = db.getSettings().pairingMode
        let device = msg.token ? db.getDeviceByTokenHash(sha256(msg.token)) : undefined

        if (msg.token && !device) {
          ws.send(JSON.stringify({ type: 'unauthorized', reason: 'unknown_token' }))
          ws.close(4401, 'unauthorized'); return
        }
        if (!msg.token) {
          if (!msg.deviceId) return
          const existing = db.getDeviceById(msg.deviceId)
          if (mode === 'required' && existing?.pairingState !== 'legacy') {
            ws.send(JSON.stringify({ type: 'unauthorized', reason: 'pairing_required' }))
            ws.close(4401, 'unauthorized'); return
          }
          device = existing
        }

        clearTimeout(killTimer)
        const now = new Date().toISOString()
        if (device) {
          deviceId = device.id
          db.updateDevice(device.id, { lastSeen: now, status: 'online' })
        } else {
          // TV connected before REST /register was called — create record now
          deviceId = msg.deviceId!
          db.upsertDevice({
            id: deviceId,
            name: msg.name ?? `TV-${deviceId.slice(0, 6)}`,
            lastSeen: now,
            status: 'online',
            registeredAt: now,
            groupIds: [],
            pairingState: 'unpaired',
          })
        }
        tvClients.set(deviceId, ws)
      } catch { /* ignore malformed messages */ }
    })

    ws.on('close', () => {
      clearTimeout(killTimer)
      if (!deviceId) return
      // Only clear the map if THIS socket still owns the id. A duplicate
      // connection closing must not mark the live screen offline.
      if (tvClients.get(deviceId) === ws) {
        tvClients.delete(deviceId)
        db.updateDevice(deviceId, { status: 'offline' })
      }
    })
  })

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      console.log(`[server] listening on http://localhost:${port}`)
      startDiscovery(port, appVersion)
      resolve(port)
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        server.close()
        startServer(userData, port + 1, appVersion).then(resolve).catch(reject)
      } else {
        reject(err)
      }
    })
  })
}
