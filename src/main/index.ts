import { join } from 'node:path'
import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { registerBooksIpc } from './ipc/booksIpc'
import { openLibrary, resolveLibraryFilePath } from './storage/library'

const isDev = !app.isPackaged

/**
 * 允许用环境变量指定数据目录，便于端到端测试与便携模式
 * 不污染用户真实的书库。必须在 app.whenReady 之前设置。
 */
const userDataOverride = process.env['EBOOK_READER_USER_DATA']
if (userDataOverride) app.setPath('userData', userDataOverride)

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 840,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f3ec',
    title: '电纸书阅读器',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

void app.whenReady().then(async () => {
  const { repository, recoveredFiles } = await openLibrary(resolveLibraryFilePath(app.getPath('userData')))
  if (recoveredFiles.length > 0) {
    console.warn('[library] 原书库文件无法读取，已备份为：', recoveredFiles.join(', '))
  }

  registerBooksIpc(ipcMain, repository)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
