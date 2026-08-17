import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import { WebSocket } from 'ws'
import type { JsonDB } from '../database'
import type { Override, OverrideContentKind, OverrideKind, OverrideTargetKind } from '../types'
import {
  MAX_SECONDS, activeFor, isRunning, overrideDefaults, overrideProblem,
  resolveOverride, targetDevices,
} from '../overrides'

// Emergency and Flash messages.
//
// Everything here is operator-only without asking: /api is gated to the manager
// app on this machine, and only the handful of routes in TV_OPEN are exempt. An
// activation endpoint must never be in that list — a screen on the LAN is not
// allowed to put a message on the rest of the building.

export function createOverridesRouter(
  db: JsonDB,
  tvClients: Map<string, WebSocket>,
) {
  const router = Router()

  /** Sends to a named set of screens, building the payload per device.
   *
   *  Per device rather than once, following the rule the groups router already
   *  states: each screen resolves its own presentation, and a shared buffer
   *  would send one screen's idea of things to all of them. */
  function sendToDevices(ids: string[], build: (deviceId: string) => object) {
    let sent = 0
    for (const id of ids) {
      const ws = tvClients.get(id)
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(build(id)))
        sent++
      }
    }
    return { sent, targeted: ids.length, offline: ids.length - sent }
  }

  /** What the manager shows about an override, including whether it is up. */
  function publicOverride(o: Override) {
    const running = isRunning(o)
    return {
      ...o,
      running,
      deviceCount: targetDevices(db, o).length,
      secondsRemaining: running && o.endsAt
        ? Math.max(0, Math.round((Date.parse(o.endsAt) - Date.now()) / 1000))
        : 0,
    }
  }

  function readBody(body: unknown): Partial<Override> {
    const b = (body ?? {}) as Record<string, unknown>
    const kind: OverrideKind = b.kind === 'flash' ? 'flash' : 'emergency'
    const targetKind = (['all', 'groups', 'devices'] as OverrideTargetKind[])
      .includes(b.targetKind as OverrideTargetKind) ? b.targetKind as OverrideTargetKind : 'all'
    const contentKind = (['design', 'app', 'image', 'text'] as OverrideContentKind[])
      .includes(b.contentKind as OverrideContentKind) ? b.contentKind as OverrideContentKind : 'text'
    const ids = Array.isArray(b.targetIds)
      ? b.targetIds.map(String).filter(s => /^[A-Za-z0-9-]{1,60}$/.test(s)).slice(0, 500)
      : []
    const hex = (v: unknown, d: string) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v) : d)
    return {
      kind,
      name: String(b.name ?? '').trim().slice(0, 80),
      targetKind,
      targetIds: ids,
      contentKind,
      designId: b.designId ? String(b.designId).slice(0, 60) : undefined,
      appInstanceId: b.appInstanceId ? String(b.appInstanceId).slice(0, 60) : undefined,
      imagePath: b.imagePath ? String(b.imagePath).slice(0, 200) : undefined,
      text: b.text ? String(b.text).slice(0, 600) : undefined,
      textColor: hex(b.textColor, '#ffffff'),
      backgroundColor: hex(b.backgroundColor, kind === 'emergency' ? '#b3261e' : '#1b2430'),
      // Passed through rather than clamped, so overrideProblem can refuse it
      // and say so. Silently turning a mistyped 999999 into half a day would
      // leave the operator believing something this feature never agreed to.
      seconds: b.seconds === undefined || b.seconds === ''
        ? overrideDefaults(kind).seconds
        : Number(b.seconds),
    }
  }

  // GET /api/overrides
  router.get('/', (_req, res) => {
    res.json({ overrides: db.getAllOverrides().map(publicOverride) })
  })

  // POST /api/overrides
  router.post('/', (req, res) => {
    const draft = readBody(req.body)
    const problem = overrideProblem(draft)
    if (problem) { res.status(400).json({ error: problem }); return }

    const now = new Date().toISOString()
    const saved = db.insertOverride({
      ...(draft as Override), id: uuid(), createdAt: now, updatedAt: now,
    })
    res.status(201).json({ override: publicOverride(saved) })
  })

  // PUT /api/overrides/:id
  router.put('/:id', (req, res) => {
    const existing = db.getOverrideById(req.params.id)
    if (!existing) { res.status(404).json({ error: 'Message not found' }); return }

    const draft = readBody({ ...existing, ...(req.body as object) })
    const problem = overrideProblem(draft)
    if (problem) { res.status(400).json({ error: problem }); return }

    // Editing does not disturb a running message: an operator tidying a name
    // mid-incident must not take the wall down.
    const updated = db.updateOverride(req.params.id, {
      ...draft, updatedAt: new Date().toISOString(),
    })!
    res.json({ override: publicOverride(updated) })
  })

  // DELETE /api/overrides/:id
  router.delete('/:id', (req, res) => {
    const existing = db.getOverrideById(req.params.id)
    if (!existing) { res.status(404).json({ error: 'Message not found' }); return }
    if (isRunning(existing)) {
      res.status(409).json({ error: 'Stand this message down before deleting it.' })
      return
    }
    db.deleteOverride(req.params.id)
    res.json({ ok: true })
  })

  /** POST /api/overrides/:id/activate — put it up now.
   *
   *  The record is written before anything is sent. A screen that is offline,
   *  rebooting, or simply misses the push finds the message the next time it
   *  asks what to play, which is what makes this trustworthy rather than
   *  merely quick. */
  router.post('/:id/activate', (req, res) => {
    const o = db.getOverrideById(req.params.id)
    if (!o) { res.status(404).json({ error: 'Message not found' }); return }

    const body = (req.body ?? {}) as { seconds?: unknown; text?: unknown }
    const seconds = Math.max(10, Math.min(MAX_SECONDS, Number(body.seconds) || o.seconds))
    // Flash allows the words to be typed at the moment of sending; Emergency
    // does not, because its content is meant to have been agreed in advance.
    const text = o.kind === 'flash' && typeof body.text === 'string' && body.text.trim()
      ? body.text.trim().slice(0, 600)
      : o.text

    const now = Date.now()
    const started = db.updateOverride(o.id, {
      seconds,
      text,
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(now + seconds * 1000).toISOString(),
      updatedAt: new Date(now).toISOString(),
    })!

    const ids = targetDevices(db, started)
    const result = sendToDevices(ids, () => ({
      type: 'override_start',
      override: resolveOverride(started, now),
    }))

    res.json({ ok: true, override: publicOverride(started), ...result })
  })

  // POST /api/overrides/:id/stand-down
  router.post('/:id/stand-down', (req, res) => {
    const o = db.getOverrideById(req.params.id)
    if (!o) { res.status(404).json({ error: 'Message not found' }); return }

    const ids = targetDevices(db, o)
    const cleared = db.updateOverride(o.id, {
      startedAt: undefined, endsAt: undefined, updatedAt: new Date().toISOString(),
    })!

    // Told to go back to normal, and told what — if anything — replaces this
    // message, because a second override may still cover the same screen.
    const result = sendToDevices(ids, id => {
      const next = activeFor(db, id)
      return next
        ? { type: 'override_start', override: resolveOverride(next) }
        : { type: 'override_end' }
    })

    res.json({ ok: true, override: publicOverride(cleared), ...result })
  })

  /** POST /api/overrides/stand-down-all — the one button that has to work.
   *
   *  Separate from cancelling them one at a time: in an incident nobody should
   *  have to work out which of four messages is on which wall. */
  router.post('/stand-down-all', (_req, res) => {
    const running = db.getAllOverrides().filter(o => isRunning(o))
    const touched = new Set<string>()
    for (const o of running) {
      targetDevices(db, o).forEach(id => touched.add(id))
      db.updateOverride(o.id, {
        startedAt: undefined, endsAt: undefined, updatedAt: new Date().toISOString(),
      })
    }
    const result = sendToDevices([...touched], () => ({ type: 'override_end' }))
    res.json({ ok: true, cleared: running.length, ...result })
  })

  return router
}
