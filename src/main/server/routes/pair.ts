import { Router } from 'express'
import { WebSocket } from 'ws'
import { v4 as uuid } from 'uuid'
import type { JsonDB } from '../database'
import { PairingStore, CODE_RE, normalizeCode, sha256 } from '../pairing'

export function createPairRouter(
  db: JsonDB,
  pairing: PairingStore,
  tvClients: Map<string, WebSocket>,
) {
  const router = Router()
  const clientIp = (req: any) => String(req.socket?.remoteAddress ?? 'unknown')

  /** Drops a screen's socket, telling it to go back to the pairing screen. */
  function evict(deviceId: string) {
    const ws = tvClients.get(deviceId)
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'unpaired' }))
        ws.close(4401, 'unpaired')
      } catch { /* socket already going away */ }
    }
  }

  // ── device-facing (open to the LAN) ────────────────────────────────────────

  // POST /api/pair/start — a screen asks for a code to display
  router.post('/start', (req, res) => {
    const { platform, playerVersion, name } = (req.body ?? {}) as Record<string, unknown>
    const result = pairing.start({
      ip: clientIp(req),
      platform: typeof platform === 'string' ? platform : undefined,
      playerVersion: typeof playerVersion === 'string' ? playerVersion : undefined,
      name: typeof name === 'string' ? name : undefined,
    })
    if (!result.ok) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds))
      res.status(429).json({ error: result.error, retryAfterSeconds: result.retryAfterSeconds })
      return
    }
    const settings = db.getSettings()
    res.json({
      userCode: result.userCode,
      deviceCode: result.deviceCode,
      expiresIn: result.expiresIn,
      interval: result.interval,
      serverId: settings.serverId,
      serverName: 'Signage Manager',
    })
  })

  // POST /api/pair/poll — the screen waits to be approved
  router.post('/poll', (req, res) => {
    const { deviceCode } = (req.body ?? {}) as Record<string, unknown>
    if (typeof deviceCode !== 'string' || !deviceCode) {
      res.status(400).json({ error: 'deviceCode required' }); return
    }
    const result = pairing.poll(deviceCode)
    if (result.status === 'expired') {
      res.status(404).json({ error: 'expired_token' }); return
    }
    if (result.status === 'paired') {
      const device = db.getDeviceById(result.deviceId)
      res.json({
        status: 'paired',
        deviceId: result.deviceId,
        token: result.token,
        name: device?.name,
        serverId: db.getSettings().serverId,
      })
      return
    }
    res.json(result)
  })

  // ── operator-facing (loopback-gated by the middleware in server/index.ts) ──

  // GET /api/pair/pending — screens currently showing a code
  router.get('/pending', (_req, res) => {
    const requests = pairing.listPending().map(p => ({
      userCode: p.userCodeFormatted,
      ip: p.ip,
      platform: p.platform,
      playerVersion: p.playerVersion,
      suggestedName: p.suggestedName,
      requestedAt: new Date(p.createdAt).toISOString(),
      expiresAt: new Date(p.expiresAt).toISOString(),
    }))
    res.json({ requests, lockedOut: pairing.lockout > 0, retryAfterSeconds: pairing.lockout })
  })

  // POST /api/pair/approve — claim the screen showing this code
  router.post('/approve', (req, res) => {
    const { code, name, groupIds, replaceDeviceId } = (req.body ?? {}) as Record<string, unknown>
    const normalized = normalizeCode(code)

    // Malformed input never counts against the attempt budget, so a stray
    // keystroke can't lock the operator out of their own screens.
    if (!CODE_RE.test(normalized)) {
      res.status(400).json({ error: 'Enter the 8-letter code shown on the screen.' }); return
    }

    const found = pairing.resolve(normalized)
    if (!found.ok) {
      if (found.reason === 'locked') {
        const secs = found.retryAfterSeconds ?? 900
        res.setHeader('Retry-After', String(secs))
        res.status(429).json({
          error: `Too many incorrect codes. Try again in ${Math.ceil(secs / 60)} minutes.`,
          retryAfterSeconds: secs,
        })
        return
      }
      res.status(404).json({ error: 'No screen is showing that code.', attemptsRemaining: found.attemptsRemaining })
      return
    }

    const rec = found.rec
    const now = new Date().toISOString()

    // Re-pairing an existing screen keeps its name, groups and history.
    let deviceId: string
    if (typeof replaceDeviceId === 'string' && replaceDeviceId) {
      const existing = db.getDeviceById(replaceDeviceId)
      if (!existing) { res.status(404).json({ error: 'That screen no longer exists.' }); return }
      evict(existing.id)
      deviceId = existing.id
    } else {
      // The server mints the id, so two screens cloned from one disk image
      // cannot collapse into a single record.
      deviceId = uuid()
      db.upsertDevice({
        id: deviceId,
        name: (typeof name === 'string' && name.trim()) || rec.suggestedName || `TV-${deviceId.slice(0, 6)}`,
        lastSeen: now,
        status: 'offline',
        registeredAt: now,
        pairingState: 'unpaired',
        platform: rec.platform,
        playerVersion: rec.playerVersion,
      })
    }

    if (typeof name === 'string' && name.trim()) db.updateDevice(deviceId, { name: name.trim().slice(0, 60) })
    if (Array.isArray(groupIds)) db.setDeviceGroups(deviceId, groupIds.filter(g => typeof g === 'string') as string[])

    const token = pairing.approve(rec, deviceId)
    db.setDeviceToken(deviceId, sha256(token))
    db.updateDevice(deviceId, { platform: rec.platform, playerVersion: rec.playerVersion })

    const device = db.getDeviceById(deviceId)
    res.json({ ok: true, deviceId, name: device?.name })
  })

  // POST /api/pair/deny
  router.post('/deny', (req, res) => {
    const normalized = normalizeCode((req.body ?? {}).code)
    if (!CODE_RE.test(normalized)) {
      res.status(400).json({ error: 'Enter the 8-letter code shown on the screen.' }); return
    }
    const found = pairing.resolve(normalized)
    if (!found.ok) { res.status(404).json({ error: 'No screen is showing that code.' }); return }
    pairing.deny(found.rec)
    res.json({ ok: true })
  })

  return router
}
