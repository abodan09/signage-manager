import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateInfo } from './updater'

contextBridge.exposeInMainWorld('electronAPI', {
  // ── existing ────────────────────────────────────────────────────────────────
  getServerUrl: (): Promise<string>      => ipcRenderer.invoke('get-server-url'),
  getLanUrl:    (): Promise<string>      => ipcRenderer.invoke('get-lan-url'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),

  // ── app info ────────────────────────────────────────────────────────────────
  getVersion: (): Promise<string> => ipcRenderer.invoke('get-version'),

  // ── updates ─────────────────────────────────────────────────────────────────
  checkForUpdates: (): Promise<UpdateInfo> => ipcRenderer.invoke('updater:check'),
  installUpdate:   (url: string): Promise<void> => ipcRenderer.invoke('updater:install', url),
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
