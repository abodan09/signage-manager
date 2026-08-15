import { Router } from 'express'
import { WebSocket } from 'ws'
import type { JsonDB } from '../database'

export function createSettingsRouter(db: JsonDB, tvClients: Map<string, WebSocket>) {
  const router = Router()

  // GET /api/settings
  router.get('/', (_req, res) => {
    const s = db.getSettings()
    const counts = db.countByPairingState()
    res.json({
      serverId: s.serverId,
      pairingMode: s.pairingMode,
      legacyCount: counts.legacy,
      unpairedCount: counts.unpaired,
      pairedCount: counts.paired,
    })
  })

  // PATCH /api/settings
  router.patch('/', (req, res) => {
    const { pairingMode } = (req.body ?? {}) as Record<string, unknown>
    if (pairingMode !== 'open' && pairingMode !== 'required') {
      res.status(400).json({ error: "pairingMode must be 'open' or 'required'" }); return
    }
    const s = db.updateSettings({ pairingMode })
    res.json({ ok: true, pairingMode: s.pairingMode })
  })

  // POST /api/settings/untrust-legacy — stop grandfathering pre-pairing screens
  router.post('/untrust-legacy', (_req, res) => {
    res.json({ ok: true, changed: db.untrustLegacyDevices() })
  })

  // POST /api/settings/reload-players — pull every screen onto the current
  // player page. Older players ignore the unknown message type, which is what
  // makes this a safe upgrade path before switching to 'required'.
  router.post('/reload-players', (_req, res) => {
    const data = JSON.stringify({ type: 'reload_player' })
    let sent = 0
    tvClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) { ws.send(data); sent++ }
    })
    res.json({ ok: true, sent })
  })

  return router
}
