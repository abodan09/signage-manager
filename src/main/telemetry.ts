import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

// Anonymous usage telemetry. What leaves the machine: a random install id, app
// version, OS family, and named feature events (no content, no media, no file
// names, no personal data). Users can turn it off in Settings → Privacy.
const INGEST_URL = process.env.SIGNAGE_TELEMETRY_URL || 'https://signage-api.frozenbit.eu/ingest'
const FLUSH_MS = 60_000
const HEARTBEAT_MS = 30 * 60_000
const MAX_QUEUE = 500
const MAX_BATCH = 150

interface TelemetryEvent {
  name: string
  ts: string
  sessionId: string
  props?: Record<string, unknown>
}

interface TelemetryFile {
  installId: string
  enabled: boolean
  queue: TelemetryEvent[]
}

const isDev = process.env.NODE_ENV === 'development'

let state: TelemetryFile | null = null
let filePath = ''
let sessionId = ''
let startedAt = 0
let flushing = false
let saveTimer: NodeJS.Timeout | null = null
let tvCountProvider: () => number = () => 0

function load(): TelemetryFile {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    if (typeof raw.installId === 'string' && raw.installId) {
      return {
        installId: raw.installId,
        enabled: raw.enabled !== false,
        queue: Array.isArray(raw.queue) ? raw.queue.slice(-MAX_QUEUE) : [],
      }
    }
  } catch { /* first run or corrupt — start fresh */ }
  return { installId: randomUUID(), enabled: true, queue: [] }
}

function save() {
  if (!state) return
  try {
    fs.writeFileSync(filePath, JSON.stringify(state), 'utf-8')
  } catch { /* disk hiccup — queue only lives in memory this run */ }
}

function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; save() }, 2_000)
}

function osLabel(): string {
  if (process.platform === 'win32') {
    const build = parseInt(os.release().split('.')[2] ?? '0', 10)
    return build >= 22000 ? 'Windows 11' : 'Windows 10'
  }
  if (process.platform === 'darwin') return 'macOS'
  return process.platform
}

/** The anonymous install id, so a report can be tied to its telemetry. */
export function getInstallId(): string {
  return state?.installId ?? ""
}

export function track(name: string, props?: Record<string, unknown>) {
  if (!state || !state.enabled || isDev) return
  state.queue.push({ name, ts: new Date().toISOString(), sessionId, props })
  if (state.queue.length > MAX_QUEUE) state.queue.splice(0, state.queue.length - MAX_QUEUE)
  scheduleSave()
}

async function flush() {
  if (!state || !state.enabled || flushing || state.queue.length === 0) return
  flushing = true
  const batch = state.queue.slice(0, MAX_BATCH)
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installId: state.installId,
        appVersion: app.getVersion(),
        os: osLabel(),
        arch: process.arch,
        locale: app.getLocale(),
        events: batch,
      }),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (res.ok) {
      state.queue.splice(0, batch.length)
      save()
    }
  } catch { /* offline — events stay queued for the next attempt */ }
  flushing = false
}

/** Called by the embedded server so heartbeats can report connected TVs. */
export function setTvCountProvider(fn: () => number) {
  tvCountProvider = fn
}

export function initTelemetry() {
  filePath = path.join(app.getPath('userData'), 'telemetry.json')
  state = load()
  sessionId = randomUUID()
  startedAt = Date.now()
  save()

  track('app_start')
  setInterval(() => {
    track('heartbeat', {
      uptimeMin: Math.round((Date.now() - startedAt) / 60_000),
      connectedTVs: tvCountProvider(),
    })
  }, HEARTBEAT_MS)
  setInterval(flush, FLUSH_MS)
  setTimeout(flush, 10_000) // first flush shortly after launch

  // On quit: persist the queue only (no network race) — unsent events flush
  // next launch with their original timestamps.
  app.on('before-quit', () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    save()
  })

  ipcMain.on('telemetry:event', (_e, name: unknown, props: unknown) => {
    if (typeof name !== 'string' || !/^[a-z0-9_.:-]{1,64}$/i.test(name)) return
    const p = props && typeof props === 'object' ? (props as Record<string, unknown>) : undefined
    track(name, p)
  })
  ipcMain.handle('telemetry:get', () => ({
    enabled: state?.enabled ?? true,
    installId: state?.installId ?? '',
  }))
  ipcMain.handle('telemetry:set', (_e, enabled: unknown) => {
    if (!state) return
    state.enabled = enabled !== false
    if (!state.enabled) state.queue = []
    save()
  })
}
