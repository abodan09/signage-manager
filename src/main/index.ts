import { app, BrowserWindow, ipcMain, shell, Menu, MenuItemConstructorOptions } from 'electron'
import path from 'path'
import { startServer } from './server'
import { setupUpdaterIpc, checkForUpdates } from './updater'

const isDev = process.env.NODE_ENV === 'development'
let mainWindow: BrowserWindow | null = null
let serverPort = 3001

function buildMenu() {
  const send = (event: string) => mainWindow?.webContents.send('menu:event', event)

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'How To…',
          accelerator: 'F1',
          click: () => send('show-help'),
        },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          click: () => send('check-updates'),
        },
        {
          label: 'About Signage Manager',
          click: () => send('about'),
        },
        { type: 'separator' },
        {
          label: 'Visit Download Page',
          click: () => shell.openExternal('https://signage.frozenbit.eu'),
        },
        {
          label: 'Report an Issue',
          click: () => shell.openExternal('https://github.com/abodan09/signage-manager/issues'),
        },
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

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

  setupUpdaterIpc(() => mainWindow)

  await app.whenReady()

  buildMenu()
  await createWindow()

  // Auto-check on startup (delay so the window can render first)
  if (!isDev) {
    setTimeout(async () => {
      const info = await checkForUpdates()
      if (info.available) {
        mainWindow?.webContents.send('menu:event', 'update-available', info)
      }
    }, 5_000)
  }

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
