import express from 'express'
import cors from 'cors'
import http from 'http'
import path from 'path'
import fs from 'fs'
import { WebSocketServer, WebSocket } from 'ws'
import { JsonDB } from './database'
import { createContentRouter } from './routes/content'
import { createDevicesRouter } from './routes/devices'
import { createPlayerRouter } from './routes/player'
import { createProjectsRouter } from './routes/projects'
import { startDiscovery, getLocalIP } from './discovery'
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
  ['PATCH',  /^\/api\/devices\/[^/]+\/?$/,                  'device_renamed'],
  ['DELETE', /^\/api\/devices\/[^/]+\/?$/,                  'device_removed'],
  ['GET',    /^\/tv\/player\/?$/,                           'player_opened'],
]

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

export async function startServer(userData: string, port: number, appVersion = '1.0.0'): Promise<number> {
  fs.mkdirSync(path.join(userData, 'uploads'), { recursive: true })

  const db = new JsonDB(userData)
  const uploadsDir = path.join(userData, 'uploads')

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
  app.use('/uploads', express.static(uploadsDir))
  app.use('/api/content', createContentRouter(db, uploadsDir, wss, tvClients))
  app.use('/api/devices', createDevicesRouter(db, wss, tvClients))
  app.use('/api/projects', createProjectsRouter(db, uploadsDir, wss, tvClients))
  app.use('/tv', createPlayerRouter())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, connectedTVs: tvClients.size })
  })

  app.get('/api/discovery', (_req, res) => {
    res.json({ ip: getLocalIP(), port, name: 'Signage Manager', version: appVersion })
  })

  wss.on('connection', (ws, _req) => {
    let deviceId: string | null = null

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; deviceId?: string; name?: string }
        if (msg.type === 'register' && msg.deviceId) {
          deviceId = msg.deviceId
          tvClients.set(deviceId, ws)
          const now = new Date().toISOString()
          const existing = db.getDeviceById(deviceId)
          if (existing) {
            db.updateDevice(deviceId, { lastSeen: now, status: 'online' })
          } else {
            // TV connected before REST /register was called — create record now
            db.upsertDevice({
              id: deviceId,
              name: msg.name ?? `TV-${deviceId.slice(0, 6)}`,
              lastSeen: now,
              status: 'online',
              registeredAt: now,
            })
          }
        }
      } catch { /* ignore malformed messages */ }
    })

    ws.on('close', () => {
      if (deviceId) {
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
