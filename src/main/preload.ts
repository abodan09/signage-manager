import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateInfo } from './updater'
import type { ReportInput, ReportResult } from './report'
import type { WhatsNew } from './updater'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── existing ────────────────────────────────────────────────────────────────
  getServerUrl: (): Promise<string>      => ipcRenderer.invoke('get-server-url'),
  getLanUrl:    (): Promise<string>      => ipcRenderer.invoke('get-lan-url'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),

  submitReport: (input: ReportInput): Promise<ReportResult> => ipcRenderer.invoke('report:submit', input),

  openReportOnGithub: (input: ReportInput): Promise<void> => ipcRenderer.invoke('report:open-github', input),

  // ── app info ────────────────────────────────────────────────────────────────
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),

  // ── anonymous usage telemetry ───────────────────────────────────────────────
  trackEvent: (name: string, props?: Record<string, unknown>): void => {
    ipcRenderer.send('telemetry:event', name, props)
  },
  getTelemetryStatus: (): Promise<{ enabled: boolean; installId: string }> =>
    ipcRenderer.invoke('telemetry:get'),
  setTelemetryEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('telemetry:set', enabled),

  // ── updates ─────────────────────────────────────────────────────────────────
  checkForUpdates: (): Promise<UpdateInfo> => ipcRenderer.invoke('updater:check'),
  getWhatsNew:     (): Promise<WhatsNew | null> => ipcRenderer.invoke('updater:whats-new'),
  installUpdate:   (info: UpdateInfo): Promise<void> => ipcRenderer.invoke('updater:install', info),
  openReleaseUrl:  (url: string): Promise<void> => ipcRenderer.invoke('updater:open-url', url),

  // ── push from main process ──────────────────────────────────────────────────
  onMenuEvent: (cb: (event: string, payload?: any) => void) => {
    ipcRenderer.on('menu:event', (_e, event, payload) => cb(event, payload))
  },
  onUpdateProgress: (cb: (pct: number) => void) => {
    ipcRenderer.on('updater:progress', (_e, pct) => cb(pct))
  },
  onUpdateError: (cb: (msg: string) => void) => {
    ipcRenderer.on('updater:error', (_e, msg) => cb(msg))
  },
})
