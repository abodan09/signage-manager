import { app, ipcMain, BrowserWindow, shell } from 'electron'
import { createWriteStream, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import https from 'https'
import type { IncomingMessage } from 'http'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import { spawn } from 'child_process'
import os from 'os'
import { track } from './telemetry'

const REPO = 'abodan09/signage-manager'
const API  = `https://api.github.com/repos/${REPO}/releases/latest`
const UA   = 'SignageManager-Updater/1.0'

/** Long enough for a slow venue link, short enough that a wedged connection
 *  does not outlive the operator's patience. */
const CHECK_TIMEOUT_MS = 15_000
/** Per-chunk, not overall: a 78 MB installer on a bad line is slow but fine,
 *  a CDN that stops sending mid-file is not. */
const STALL_TIMEOUT_MS = 60_000

export interface UpdateInfo {
  available: boolean
  version?: string
  currentVersion: string
  downloadUrl?: string
  releasePageUrl: string
  releaseNotes?: string   // bullet-point summary from GitHub release body
  /** From the release's latest.yml, when it has one. Both are checked against
   *  the bytes that actually arrive before anything is executed. */
  sha512?: string
  size?: number
  /** Why the check failed. Absent on success — and the only thing that may be
   *  used to decide whether "up to date" is the truth or an unreported error. */
  error?: string
}

/** The notes are rendered as plain text, so Markdown emphasis has to come off
 *  or the operator reads literal asterisks. */
function stripMarkdown(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')   // links → their text
    .replace(/(\*\*|__)(.+?)\1/g, '$2')        // bold
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s.,;:!?)]|$)/g, '$1$2') // italic
    .replace(/`([^`]+)`/g, '$1')               // inline code
    .trim()
}

export function parseReleaseNotes(body: string): string {
  // Extract bullet lines from the GitHub release Markdown body
  const lines = body.split('\n')
  const bullets = lines
    .map(l => l.trim())
    .filter(l => l.startsWith('- ') || l.startsWith('* ') || l.startsWith('• '))
    .map(l => stripMarkdown(l.replace(/^[-*•]\s+/, '').trim()))
    .filter(Boolean)
  if (bullets.length > 0) return bullets.join('\n')

  // No bullets at all. The fallback used to hand back raw Markdown, which put
  // "## What's Changed" and "**Full Changelog**: https://…" on screen —
  // exactly what the stripper above exists to prevent. Headings and the
  // generated compare link are boilerplate, not news, so they go.
  return lines
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !/^\**Full Changelog\**\s*:/i.test(l))
    .map(stripMarkdown)
    .filter(Boolean)
    .slice(0, 5)
    .join('\n')
}

/** Compares the numeric core of two versions.
 *
 *  Every part is parsed with a floor of 0 rather than Number(), because
 *  Number('0-rc') is NaN and NaN comparisons are all false — which silently
 *  told anyone running a prerelease build that they were up to date, for
 *  ever. A prerelease now compares equal to its own release, so 1.9.0 still
 *  supersedes 1.9.0-rc.1. */
export function versionGt(a: string, b: string): boolean {
  const parts = (v: string) => String(v).split('-')[0].split('.').map(p => {
    const n = parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
  const pa = parts(a), pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Turns a status code into something an operator can act on. GitHub puts the
 *  reason in the body and it is usually the useful half. */
export function describeStatus(code: number, body: string): string {
  let detail = ''
  try { detail = String((JSON.parse(body) as { message?: string })?.message ?? '') } catch { /* not JSON */ }
  if (code === 403 || code === 429) {
    return /rate limit/i.test(detail)
      ? 'GitHub is rate-limiting this network, so the update check was refused. It usually clears within the hour.'
      : `The update service refused the request (HTTP ${code}).`
  }
  if (code === 404) return 'The update service could not find the release list.'
  if (code >= 500) return `The update service is having trouble (HTTP ${code}). Try again later.`
  return detail ? `HTTP ${code}: ${detail}` : `HTTP ${code}`
}

/**
 * A GET that always settles.
 *
 * The old one could hang for ever, and did: `setTimeout` on a request is a
 * socket-inactivity timer, so it also arms *after* the headers arrive. Once a
 * response exists Node reports the abort on the response, not the request —
 * and an IncomingMessage with no 'error' listener deliberately swallows it
 * rather than crashing. A proxy that answered 200 and then went quiet
 * therefore produced no data, no error and no rejection: the promise simply
 * never resolved, and every caller waited for ever. Callers of this function
 * MUST attach their own 'error' handler to the stream they are given, which
 * is what makes the abort visible.
 *
 * Resolves with a live 2xx response. Redirects are followed; anything else is
 * an error with a sentence in it.
 */
export function openStream(url: string, timeoutMs: number, hops = 0): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (hops > 5) { reject(new Error('The download address redirected too many times.')); return }

    let settled = false
    const finish = (fn: () => void) => { if (!settled) { settled = true; fn() } }

    let req: ReturnType<typeof https.get>
    try {
      req = https.get(url, { headers: { 'User-Agent': UA } }, res => {
        const code = res.statusCode ?? 0

        if (code >= 300 && code < 400) {
          const location = res.headers.location
          // Drain it, or under keep-alive the socket is never released.
          res.resume()
          if (!location) {
            // Previously this passed undefined to https.get, which quietly
            // defaulted to localhost:443 — an app that runs its own local
            // server has no business fetching an installer from itself.
            finish(() => reject(new Error(`The server redirected without saying where (HTTP ${code}).`)))
            return
          }
          let next: string
          try { next = new URL(location, url).toString() } catch {
            finish(() => reject(new Error('The server redirected somewhere unreadable.')))
            return
          }
          finish(() => { openStream(next, timeoutMs, hops + 1).then(resolve, reject) })
          return
        }

        if (code < 200 || code >= 300) {
          // Read a little of the body for the reason, then fail loudly. The
          // old code wrote whatever this was straight into the .exe.
          let raw = ''
          res.setEncoding('utf-8')
          res.on('data', (c: string) => { if (raw.length < 2000) raw += c })
          res.on('error', () => finish(() => reject(new Error(`HTTP ${code}`))))
          res.on('end', () => finish(() => reject(new Error(describeStatus(code, raw)))))
          return
        }

        finish(() => resolve(res))
      })
    } catch (e) {
      reject(new Error(`Could not start the request (${messageOf(e)}).`))
      return
    }

    req.on('error', err => finish(() => reject(err)))
    // Destroyed WITH an error on purpose: destroy() with no argument does not
    // always surface anywhere, and silence is the bug this replaces.
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('The update service did not respond in time.'))
    })
  })
}

function readAll(res: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = ''
    res.setEncoding('utf-8')
    res.on('data', (c: string) => {
      raw += c
      if (raw.length > maxBytes) { res.destroy(); reject(new Error('The reply was unreasonably large.')) }
    })
    res.on('end', () => resolve(raw))
    res.on('error', reject)
    res.on('aborted', () => reject(new Error('The connection closed before the reply finished.')))
  })
}

async function fetchJson(url: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<any> {
  const res = await openStream(url, timeoutMs)
  const body = await readAll(res, 4_000_000)
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('The update service sent something that was not a release list.')
  }
}

/** electron-builder writes this beside the installer. It names the exact file
 *  the release is meant to hand out, with its hash and length — the only
 *  reason this updater can tell a finished download from a truncated one. */
export function parseLatestYml(text: string): { path?: string; sha512?: string; size?: number } {
  // Hand-parsed rather than pulling in a YAML dependency for six lines. The
  // top-level keys are unindented, which is what separates them from the
  // repeated ones inside `files:`.
  const path = /^path:\s*(.+?)\s*$/m.exec(text)?.[1]
  const sha512 = /^sha512:\s*(.+?)\s*$/m.exec(text)?.[1]
  const size = /^\s+size:\s*(\d+)\s*$/m.exec(text)?.[1]
  return {
    path: path || undefined,
    sha512: sha512 || undefined,
    size: size ? Number(size) : undefined,
  }
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const releasePageUrl = `https://github.com/${REPO}/releases/latest`
  try {
    const data   = await fetchJson(API)
    const latest = String(data?.tag_name ?? '').replace(/^v/, '')
    // A reply with no tag is not "no update", it is a reply we did not
    // understand — and saying "up to date" to that is how a fleet sits on an
    // old version for a year while reporting itself current.
    if (!latest) throw new Error('The update service did not name a latest version.')

    if (!versionGt(latest, current)) {
      return { available: false, currentVersion: current, releasePageUrl }
    }

    const assets: Array<{ name: string; browser_download_url: string }> = data?.assets ?? []
    const releaseNotes = parseReleaseNotes(String(data?.body ?? ''))

    // Prefer the installer the manifest actually describes; its hash is the
    // one we can check. Falling back to "any .exe" keeps older releases, which
    // predate the manifest, installable — unverified but not broken.
    let manifest: { path?: string; sha512?: string; size?: number } = {}
    const ymlAsset = assets.find(a => a.name === 'latest.yml')
    if (ymlAsset) {
      try {
        const res = await openStream(ymlAsset.browser_download_url, CHECK_TIMEOUT_MS)
        manifest = parseLatestYml(await readAll(res, 64_000))
      } catch {
        // No manifest is a weaker guarantee, not a reason to block an update.
      }
    }

    const named = manifest.path ? assets.find(a => a.name === manifest.path) : undefined
    const exeAsset = named ?? assets.find(a => a.name.toLowerCase().endsWith('.exe'))

    return {
      available: true,
      version: latest,
      currentVersion: current,
      downloadUrl: exeAsset?.browser_download_url,
      releasePageUrl,
      releaseNotes,
      sha512: named ? manifest.sha512 : undefined,
      size: named ? manifest.size : undefined,
    }
  } catch (e) {
    return { available: false, currentVersion: current, releasePageUrl, error: messageOf(e) }
  }
}

/** One at a time. Two downloads into one path wrote at independent offsets and
 *  then both ran the result. */
let downloading = false

export async function downloadAndInstall(
  info: { downloadUrl: string; version?: string; sha512?: string; size?: number },
  onProgress: (pct: number) => void,
): Promise<void> {
  if (downloading) throw new Error('An update is already downloading.')
  downloading = true

  const dest = join(os.tmpdir(), `signage-manager-update-${info.version ?? 'latest'}.exe`)
  const discard = () => { try { unlinkSync(dest) } catch { /* never existed, or is gone */ } }

  try {
    const res = await openStream(info.downloadUrl, STALL_TIMEOUT_MS)

    const declared = Number(res.headers['content-length'] ?? 0) || info.size || 0
    let received = 0
    let lastPct = -1
    const hash = createHash('sha512')

    res.on('data', (chunk: Buffer) => {
      received += chunk.length
      hash.update(chunk)
      if (declared > 0) {
        const pct = Math.round(received / declared * 100)
        // One message per whole percent instead of one per chunk: the old rate
        // was ~1,500 IPC round trips and React renders for one download.
        if (pct !== lastPct) { lastPct = pct; onProgress(Math.min(100, pct)) }
      }
    })

    // pipeline gives backpressure and, more importantly, propagates an error
    // from EITHER end — including the write failing on a full or read-only
    // temp directory, which used to be an uncaught exception that killed the
    // whole app the instant the operator clicked Update.
    await pipeline(res, createWriteStream(dest))

    // What arrived has to be what was promised. A close-delimited response
    // that dies halfway fires 'end' like a complete one, so without this a
    // truncated installer was executed — after the NSIS script had already
    // killed the running app.
    if (info.size && received !== info.size) {
      throw new Error(`The download stopped early (${received} of ${info.size} bytes).`)
    }
    if (!info.size && declared > 0 && received !== declared) {
      throw new Error(`The download stopped early (${received} of ${declared} bytes).`)
    }
    if (info.sha512) {
      const got = hash.digest('base64')
      if (got !== info.sha512) throw new Error('The downloaded installer did not match its checksum.')
    }

    // --updated marks this as an update (keeps shortcuts/app data),
    // --force-run relaunches the app when the silent install finishes.
    // The installer itself closes any still-running app instance
    // before touching files (customInit in build/installer.nsh).
    const child = spawn(dest, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' })
    // Waiting for 'spawn' is what stops the app quitting into nothing. An
    // installer that will not start — quarantined by antivirus, or not a real
    // executable — used to raise an unhandled 'error' event, which took the
    // main process down with it: the window simply vanished, taking the
    // signage server and every screen's content source with it.
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve())
      child.once('error', err => reject(new Error(`The installer would not start (${messageOf(err)}).`)))
    })
    child.unref()
    track('app_update_installer_started')
    app.quit()
  } catch (e) {
    discard()
    throw e
  } finally {
    downloading = false
  }
}

export function setupUpdaterIpc(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('get-version', () => app.getVersion())

  ipcMain.handle('updater:check', () => checkForUpdates())

  ipcMain.handle('updater:install', async (_e, info: unknown) => {
    const win = getWindow()
    const send = (ch: string, ...args: any[]) => win?.webContents.send(ch, ...args)

    // The renderer used to pass a bare URL and this downloaded and executed
    // whatever it named. It is still the renderer asking, but the address now
    // has to be one of ours.
    const req = (info && typeof info === 'object' ? info : {}) as {
      downloadUrl?: string; version?: string; sha512?: string; size?: number
    }
    const url = String(req.downloadUrl ?? '')
    if (!/^https:\/\/(github\.com|[a-z0-9-]+\.githubusercontent\.com)\//i.test(url)) {
      send('updater:error', 'That download address is not a Signage Manager release.')
      return
    }

    try {
      track('app_update_started')
      await downloadAndInstall(
        { downloadUrl: url, version: req.version, sha512: req.sha512, size: req.size },
        pct => send('updater:progress', pct),
      )
    } catch (err: unknown) {
      track('app_update_failed')
      send('updater:error', messageOf(err))
    }
  })

  ipcMain.handle('updater:open-url', (_e, url: string) => {
    if (/^https:\/\//i.test(String(url))) void shell.openExternal(String(url))
  })
}

/* ── what's new, after the fact ─────────────────────────────────────────────
   The update banner announces that a version exists; this announces what
   arrived, and only once the operator is actually running it. Which is the
   honest moment for it: before installing, a change list is a sales pitch for
   a decision already made by clicking Update.

   The last version to have run is kept beside the telemetry state in userData.
   A first-ever install writes the marker and shows nothing — there is no
   "what's new" when everything is new.                                       */

const SEEN_FILE = 'last-run-version.json'

function seenPath(): string {
  return join(app.getPath('userData'), SEEN_FILE)
}

function readSeenVersion(): string | null {
  try {
    const raw = JSON.parse(readFileSync(seenPath(), 'utf-8'))
    return typeof raw?.version === 'string' ? raw.version : null
  } catch {
    return null
  }
}

function writeSeenVersion(v: string) {
  try {
    writeFileSync(seenPath(), JSON.stringify({ version: v }), 'utf-8')
  } catch {
    // Not worth failing a launch over. The worst case is the panel appearing
    // twice, which is far better than a startup that dies writing a marker.
  }
}

export interface WhatsNew {
  version: string
  previousVersion: string
  notes: string[]
  releasePageUrl: string
}

/** Populated during startup, so the renderer can ask without waiting on GitHub. */
let pendingWhatsNew: WhatsNew | null = null
/** The in-flight preparation. The renderer asks as soon as it mounts, which is
 *  routinely before GitHub has answered; without something to wait on, the
 *  one-shot handler returned null and the notes for that upgrade were lost for
 *  good, because the marker had already been written. */
let whatsNewReady: Promise<void> | null = null

/**
 * Decides whether this run is the first after an upgrade, and if so fetches the
 * notes for the version now running. Called once at startup; failures are
 * silent, because a missing change list must never hold up the app.
 */
export function prepareWhatsNew(): Promise<void> {
  whatsNewReady = (async () => {
    const current = app.getVersion()
    const previous = readSeenVersion()

    // Same version as last run, or a first-ever install: nothing to announce.
    if (previous === current) return
    writeSeenVersion(current)
    if (!previous || !versionGt(current, previous)) return

    try {
      const rel = await fetchJson(`https://api.github.com/repos/${REPO}/releases/tags/v${current}`)
      const notes = parseReleaseNotes(String(rel?.body ?? ''))
        .split('\n').map((l: string) => l.trim()).filter(Boolean)
      if (!notes.length) return
      pendingWhatsNew = {
        version: current,
        previousVersion: previous,
        notes,
        releasePageUrl: rel?.html_url || `https://github.com/${REPO}/releases/tag/v${current}`,
      }
    } catch {
      // Offline, or the release has no notes yet. Say nothing.
    }
  })()
  return whatsNewReady
}

export function setupWhatsNewIpc() {
  // Handed over exactly once: asking again in the same run returns nothing, so
  // a re-render cannot bring the panel back.
  ipcMain.handle('updater:whats-new', async () => {
    try { await whatsNewReady } catch { /* prepare never rejects, but be sure */ }
    const out = pendingWhatsNew
    pendingWhatsNew = null
    return out
  })
}
