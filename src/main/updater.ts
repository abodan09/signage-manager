import { app, ipcMain, BrowserWindow, shell } from 'electron'
import { createWriteStream } from 'fs'
import { join } from 'path'
import https from 'https'
import { spawn } from 'child_process'
import os from 'os'

const REPO = 'abodan09/signage-manager'
const API  = `https://api.github.com/repos/${REPO}/releases/latest`

export interface UpdateInfo {
  available: boolean
  version?: string
  currentVersion: string
  downloadUrl?: string
  releasePageUrl: string
  releaseNotes?: string   // bullet-point summary from GitHub release body
}

function parseReleaseNotes(body: string): string {
  // Extract bullet lines from the GitHub release Markdown body
  const lines = body.split('\n')
  const bullets = lines
    .map(l => l.trim())
    .filter(l => l.startsWith('- ') || l.startsWith('* ') || l.startsWith('• '))
    .map(l => l.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean)
  return bullets.length > 0 ? bullets.join('\n') : body.split('\n').filter(l => l.trim()).slice(0, 5).join('\n')
}

function versionGt(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SignageManager-Updater/1.0' } }, res => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        fetchJson(res.headers.location!).then(resolve).catch(reject)
        return
      }
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(10_000, () => req.destroy())
  })
}

export async function checkForUpdates(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const releasePageUrl = `https://github.com/${REPO}/releases/latest`
  try {
    const data   = await fetchJson(API)
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    if (!latest) return { available: false, currentVersion: current, releasePageUrl }

    if (!versionGt(latest, current)) {
      return { available: false, currentVersion: current, releasePageUrl }
    }

    const exeAsset = (data.assets ?? []).find((a: any) => a.name.endsWith('.exe'))
    const releaseNotes = parseReleaseNotes(data.body ?? '')
    return {
      available: true,
      version: latest,
      currentVersion: current,
      downloadUrl: exeAsset?.browser_download_url,
      releasePageUrl,
      releaseNotes,
    }
  } catch {
    return { available: false, currentVersion: current, releasePageUrl }
  }
}

export function downloadAndInstall(
  downloadUrl: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const dest = join(os.tmpdir(), 'signage-manager-update.exe')
    const file = createWriteStream(dest)

    const doDownload = (url: string) => {
      https.get(url, { headers: { 'User-Agent': 'SignageManager-Updater/1.0' } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          doDownload(res.headers.location!)
          return
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10)
        let received = 0
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          file.write(chunk)
          if (total > 0) onProgress(Math.round(received / total * 100))
        })
        res.on('end', () => {
          file.close(() => {
            // --updated marks this as an update (keeps shortcuts/app data),
            // --force-run relaunches the app when the silent install finishes.
            // The installer itself closes any still-running app instance
            // before touching files (customInit in build/installer.nsh).
            spawn(dest, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
            app.quit()
            resolve()
          })
        })
        res.on('error', reject)
      }).on('error', err => { file.close(); reject(err) })
    }

    doDownload(downloadUrl)
  })
}

export function setupUpdaterIpc(getWindow: () => BrowserWindow | null) {
  ipcMain.handle('get-version', () => app.getVersion())

  ipcMain.handle('updater:check', () => checkForUpdates())

  ipcMain.handle('updater:install', async (_e, url: string) => {
    const win = getWindow()
    const send = (ch: string, ...args: any[]) => win?.webContents.send(ch, ...args)
    try {
      await downloadAndInstall(url, pct => send('updater:progress', pct))
    } catch (err: any) {
      send('updater:error', err.message ?? String(err))
    }
  })

  ipcMain.handle('updater:open-url', (_e, url: string) => shell.openExternal(url))
}
