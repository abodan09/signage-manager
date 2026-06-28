import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import { startServer } from './server'

const isDev = process.env.NODE_ENV === 'development'
let mainWindow: BrowserWindow | null = null
let serverPort = 3001

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

async function main() {
  const userData = app.getPath('userData')

  serverPort = await startServer(userData, 3001)

  ipcMain.handle('get-server-url', () => `http://localhost:${serverPort}`)
  ipcMain.handle('open-external', (_event, url: string) => shell.openExternal(url))

  await app.whenReady()
  await createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

main().catch(err => {
  console.error('[main] fatal error:', err)
  app.quit()
})
