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
      // Drives the first-run template picker. True until the operator has
      // either installed a category or explicitly skipped, so an upgrade of an
      // existing install is asked exactly once too.
      needsTemplateSetup: !s.templatesOnboardedAt && db.getInstalledPacks().length === 0,
    })
  })

  // PATCH /api/settings
  router.patch('/', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>

    // Dismissing the first-run template picker is its own patch — it must not
    // require sending pairingMode along with it.
    if (body.templatesOnboarded !== undefined) {
      const s = db.updateSettings({ templatesOnboardedAt: new Date().toISOString() })
      res.json({ ok: true, templatesOnboardedAt: s.templatesOnboardedAt }); return
    }

    const { pairingMode } = body
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
