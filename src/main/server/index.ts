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

export async function startServer(userData: string, port: number): Promise<number> {
  fs.mkdirSync(path.join(userData, 'uploads'), { recursive: true })

  const db = new JsonDB(userData)
  const uploadsDir = path.join(userData, 'uploads')

  const app = express()
  const server = http.createServer(app)
  const wss = new WebSocketServer({ server })

  // deviceId → WebSocket (TV clients only)
  const tvClients = new Map<string, WebSocket>()

  app.use(cors())
  app.use(express.json())
  app.use('/uploads', express.static(uploadsDir))
  app.use('/api/content', createContentRouter(db, uploadsDir, wss, tvClients))
  app.use('/api/devices', createDevicesRouter(db, wss, tvClients))
  app.use('/tv', createPlayerRouter())

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, connectedTVs: tvClients.size })
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
      resolve(port)
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Try next port
        server.close()
        startServer(userData, port + 1).then(resolve).catch(reject)
      } else {
        reject(err)
      }
    })
  })
}
