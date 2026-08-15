// Minimal Electron stand-in so the real server module can boot under plain Node.
const os = require('os')
const path = require('path')
const fs = require('fs')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sig-electron-'))
module.exports = {
  app: {
    getPath: () => dir,
    getVersion: () => '1.7.0',
    getLocale: () => 'en-US',
    on: () => {},
  },
  ipcMain: { on: () => {}, handle: () => {} },
  BrowserWindow: class {},
  shell: { openExternal: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: { invoke: () => Promise.resolve(), on: () => {}, send: () => {} },
}
