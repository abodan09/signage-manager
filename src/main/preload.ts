import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  getServerUrl: (): Promise<string> => ipcRenderer.invoke('get-server-url'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
})
