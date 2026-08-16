import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { JsonDB } from '../database'
import { fontFaceCss } from '../fonts'
import type { AppConnection, AppContext, AppDefinition, AppInstance } from './types'
import { APPS, getApp } from './registry'

// Holds everything an app instance needs at runtime: its cached third-party
// data, the account it speaks to, and the loop that keeps both fresh.
//
// The manager does the fetching so a wall of screens costs one API call and no
// screen ever holds a credential. The cache is written to disk, so a manager
// that restarts — or a network that drops — still renders the last good copy
// instead of an empty frame.

interface CacheEntry {
  data: unknown
  fetchedAt: number
  expiresAt: number
  /** Set when the last attempt failed; the stale data is still served. */
  lastError?: string
  failures?: number
}

const SWEEP_MS = 60_000
const MIN_TTL_MS = 30_000
/** After repeated failures, back off rather than hammering a dead endpoint. */
const BACKOFF_MS = [60_000, 300_000, 900_000, 1_800_000]

export class AppStore {
  private db: JsonDB
  private cacheDir: string
  private mediaDir: string
  private connectionsFile: string
  private fontsDir: string
  private cache = new Map<string, CacheEntry>()
  private mediaIndex = new Map<string, string>()
  private connections: Record<string, AppConnection> = {}
  private inFlight = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(db: JsonDB, dataDir: string, assetsDir: string) {
    this.db = db
    this.cacheDir = path.join(dataDir, 'app-cache')
    this.mediaDir = path.join(dataDir, 'app-media')
    this.connectionsFile = path.join(dataDir, 'connections.json')
    this.fontsDir = path.join(assetsDir, 'fonts')
    fs.mkdirSync(this.cacheDir, { recursive: true })
    fs.mkdirSync(this.mediaDir, { recursive: true })
    this.loadConnections()
    this.loadCache()
    this.loadMediaIndex()
  }

  get mediaPath() { return this.mediaDir }

  private loadMediaIndex() {
    try {
      for (const f of fs.readdirSync(this.mediaDir)) {
        this.mediaIndex.set(f.replace(/\.[^.]+$/, ''), f)
      }
    } catch { /* first run */ }
  }

  // ── connections ────────────────────────────────────────────────────────────

  private loadConnections() {
    try {
      this.connections = JSON.parse(fs.readFileSync(this.connectionsFile, 'utf-8'))
    } catch {
      this.connections = {}   // first run, or the file was removed to sign out
    }
  }

  private saveConnections() {
    const tmp = `${this.connectionsFile}.tmp`
    // 0600: access tokens are as good as a password for the linked account.
    fs.writeFileSync(tmp, JSON.stringify(this.connections, null, 2), { encoding: 'utf-8', mode: 0o600 })
    fs.renameSync(tmp, this.connectionsFile)
    try { fs.chmodSync(this.connectionsFile, 0o600) } catch { /* not POSIX — Windows ACLs already restrict userData */ }
  }

  getConnection(provider: string): AppConnection | undefined {
    return this.connections[provider]
  }

  setConnection(conn: AppConnection) {
    this.connections[conn.provider] = conn
    this.saveConnections()
    // A new account means every instance using it is showing the wrong feed.
    this.invalidateProvider(conn.provider)
  }

  clearConnection(provider: string): boolean {
    if (!this.connections[provider]) return false
    delete this.connections[provider]
    this.saveConnections()
    this.invalidateProvider(provider)
    return true
  }

  /** What the UI may see — never the token itself. */
  publicConnections() {
    return Object.values(this.connections).map(c => ({
      provider: c.provider,
      accountName: c.accountName,
      accountId: c.accountId,
      connectedAt: c.connectedAt,
      expiresAt: c.expiresAt,
      expired: !!c.expiresAt && c.expiresAt < Date.now(),
    }))
  }

  private invalidateProvider(provider: string) {
    for (const inst of this.db.getAllAppInstances()) {
      if (getApp(inst.appId)?.provider === provider) this.invalidate(inst.id)
    }
  }

  // ── data cache ─────────────────────────────────────────────────────────────

  private cachePath(id: string) { return path.join(this.cacheDir, `${id}.json`) }

  private loadCache() {
    let files: string[] = []
    try { files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.json')) } catch { return }
    for (const f of files) {
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(this.cacheDir, f), 'utf-8')) as CacheEntry
        this.cache.set(f.replace(/\.json$/, ''), entry)
      } catch { /* a corrupt cache file just means a refetch */ }
    }
  }

  private writeCache(id: string, entry: CacheEntry) {
    this.cache.set(id, entry)
    try {
      const tmp = `${this.cachePath(id)}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(entry), 'utf-8')
      fs.renameSync(tmp, this.cachePath(id))
    } catch { /* disk hiccup — the in-memory copy still serves this run */ }
  }

  invalidate(id: string) {
    this.cache.delete(id)
    try { fs.unlinkSync(this.cachePath(id)) } catch { /* nothing cached yet */ }
  }

  getCached(id: string): CacheEntry | undefined {
    return this.cache.get(id)
  }

  // ── refresh ────────────────────────────────────────────────────────────────

  /** Fetches fresh data for one instance. Never throws: a failed refresh keeps
   *  the previous data on screen, which is always better than a blank panel. */
  async refresh(instance: AppInstance, baseUrl: string, force = false): Promise<void> {
    const def = getApp(instance.appId)
    if (!def?.refresh) return
    if (this.inFlight.has(instance.id)) return

    const existing = this.cache.get(instance.id)
    if (!force && existing && existing.expiresAt > Date.now()) return

    if (!force && existing?.failures) {
      const wait = BACKOFF_MS[Math.min(existing.failures - 1, BACKOFF_MS.length - 1)]
      if (Date.now() - existing.fetchedAt < wait) return
    }

    this.inFlight.add(instance.id)
    try {
      const result = await def.refresh(this.context(instance, baseUrl))
      this.writeCache(instance.id, {
        data: result.data,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + Math.max(MIN_TTL_MS, result.ttlSeconds * 1000),
      })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'refresh failed'
      console.warn(`[apps] ${instance.appId} refresh failed:`, message)
      this.writeCache(instance.id, {
        // Keep whatever was showing; only the bookkeeping changes.
        data: existing?.data ?? null,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + MIN_TTL_MS,
        lastError: message,
        failures: (existing?.failures ?? 0) + 1,
      })
    } finally {
      this.inFlight.delete(instance.id)
    }
  }

  /** Starts the background sweep that keeps every instance's data warm. */
  startSweeper(getBaseUrl: () => string) {
    if (this.timer) return
    const tick = () => {
      const base = getBaseUrl()
      for (const inst of this.db.getAllAppInstances()) {
        void this.refresh(inst, base)
      }
    }
    // First pass shortly after boot so screens are current before anyone looks.
    setTimeout(tick, 8_000).unref?.()
    this.timer = setInterval(tick, SWEEP_MS)
    this.timer.unref?.()
  }

  stopSweeper() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  // ── media mirror ───────────────────────────────────────────────────────────

  /** Copies a remote image into the manager and returns a local path.
   *
   *  Three separate problems, one answer. Instagram hands out signed CDN URLs
   *  that expire in hours, so a cached playlist would show broken images by
   *  morning. Old TV WebViews fail on modern TLS and expired root CAs, so they
   *  often cannot load a third-party CDN at all. And a screen with no WAN still
   *  has to keep playing. Serving a local copy fixes all three at once.
   *
   *  Returns null on failure; callers fall back to the remote URL rather than
   *  dropping the post. */
  async mirrorImage(url: string, maxBytes = 12 * 1024 * 1024): Promise<string | null> {
    // http as well as https: a self-hosted feed on the customer's own LAN is a
    // legitimate source. The trust boundary is the feed URL, which the operator
    // typed on this machine; image URLs inherit that trust. What actually keeps
    // this safe is below — the response must declare an image content type and
    // fit the size cap, so a URL pointed somewhere else yields nothing useful.
    if (!/^https?:\/\//i.test(url)) return null
    const key = crypto.createHash('sha1').update(url.split('?')[0]).digest('hex').slice(0, 24)

    // Already have it? A signed URL changes its query string constantly, so the
    // hash deliberately ignores it — the underlying image is the same file.
    const existing = this.mediaIndex.get(key)
    if (existing && fs.existsSync(path.join(this.mediaDir, existing))) {
      return `/app-media/${existing}`
    }

    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 20_000)
      let res: Response
      try {
        res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SignageManager/1.0' } })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) return null

      const type = res.headers.get('content-type') || ''
      if (!/^image\//i.test(type)) return null
      const declared = Number(res.headers.get('content-length') || 0)
      if (declared > maxBytes) return null

      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > maxBytes) return null

      // The stored extension is what express.static uses to pick a Content-Type,
      // so an unmapped type would be saved as a file no browser will draw. When
      // the type is one we cannot name, decline the mirror and let the caller
      // fall back to the remote URL — a working remote image beats a local one
      // the TV refuses to render.
      const ext = /jpeg|jpg/i.test(type) ? '.jpg'
        : /png/i.test(type) ? '.png'
        : /webp/i.test(type) ? '.webp'
        : /gif/i.test(type) ? '.gif'
        : /svg/i.test(type) ? '.svg'
        : /avif/i.test(type) ? '.avif'
        : /bmp/i.test(type) ? '.bmp'
        : null
      if (!ext) return null
      const name = key + ext
      fs.writeFileSync(path.join(this.mediaDir, name), buf)
      this.mediaIndex.set(key, name)
      return `/app-media/${name}`
    } catch {
      return null   // offline, timeout, or a CDN that refused us
    }
  }

  /** Drops mirrored files nothing references any more. Called after a refresh,
   *  so a wall that has scrolled past a hundred posts does not fill the disk. */
  pruneMedia(keepPaths: Set<string>) {
    let files: string[] = []
    try { files = fs.readdirSync(this.mediaDir) } catch { return }
    const keep = new Set([...keepPaths].map(p => path.basename(p)))
    for (const f of files) {
      if (keep.has(f)) continue
      try {
        // Grace period: a file may belong to an instance refreshing right now.
        const age = Date.now() - fs.statSync(path.join(this.mediaDir, f)).mtimeMs
        if (age < 6 * 60 * 60_000) continue
        fs.unlinkSync(path.join(this.mediaDir, f))
        for (const [k, v] of this.mediaIndex) if (v === f) this.mediaIndex.delete(k)
      } catch { /* raced with something else — try again next sweep */ }
    }
  }

  private context(instance: AppInstance, baseUrl: string): AppContext {
    const def = getApp(instance.appId)
    return {
      instance,
      data: this.cache.get(instance.id)?.data ?? null,
      fontCss: fontFaceCss(this.fontsDir),
      baseUrl,
      connection: def?.provider ? this.connections[def.provider] : undefined,
      mirror: (url: string) => this.mirrorImage(url),
    }
  }

  /** A name the app learned from its first fetch, or null. */
  suggestName(instance: AppInstance, baseUrl: string): string | null {
    const def = getApp(instance.appId)
    if (!def?.suggestName) return null
    try {
      const name = def.suggestName(this.context(instance, baseUrl))
      return name ? name.trim().slice(0, 80) || null : null
    } catch {
      return null
    }
  }

  /** What GET /tv/app/:id/data returns. */
  serialize(instance: AppInstance, baseUrl: string): unknown {
    const def = getApp(instance.appId)
    const entry = this.cache.get(instance.id)
    if (!def?.serializeData) return entry?.data ?? null
    try {
      return def.serializeData(this.context(instance, baseUrl))
    } catch {
      return entry?.data ?? null
    }
  }

  render(instance: AppInstance, baseUrl: string): string {
    const def = getApp(instance.appId)
    if (!def) return errorPage('This app is no longer available.')
    try {
      return def.render(this.context(instance, baseUrl))
    } catch (e: unknown) {
      console.warn(`[apps] ${instance.appId} render failed:`, e)
      return errorPage('This app could not be displayed.')
    }
  }

  /** Everything the UI needs about an instance, cache health included, so the
   *  operator can see "last updated 3 minutes ago" rather than guessing. */
  publicInstance(instance: AppInstance) {
    const def = getApp(instance.appId)
    const entry = this.cache.get(instance.id)
    return {
      ...instance,
      appName: def?.name ?? instance.appId,
      appIcon: def?.icon ?? '🧩',
      needsConnection: !!def?.provider && !this.connections[def.provider],
      lastFetchedAt: entry ? new Date(entry.fetchedAt).toISOString() : undefined,
      lastError: entry?.lastError,
    }
  }

  definitions() { return APPS }
}

function errorPage(message: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>App</title></head>` +
    `<body style="margin:0;height:100%;background:#0b1220;color:#64748b;font-family:Arial,Helvetica,sans-serif">` +
    `<div style="position:absolute;top:50%;left:0;right:0;text-align:center;font-size:28px">${message}</div>` +
    `</body></html>`
}
