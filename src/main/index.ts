import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { registerAnnotationsIpc } from './ipc/annotationsIpc'
import { registerBooksIpc } from './ipc/booksIpc'
import { registerLibraryIpc } from './ipc/libraryIpc'
import { registerSettingsIpc } from './ipc/settingsIpc'
import { FileBookStore } from './import/fileBookStore'
import { openSettings, resolveSettingsFilePath } from './storage/settings'
import { openStorageForStartup } from './storage/startup'

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

async function startApplication(): Promise<void> {
  const userDataDir = app.getPath('userData')
  const storage = await openStorageForStartup(userDataDir)
  // 降级启动与「救回来」的启动都必须留痕，否则用户只会看到书架空了、划线没了
  for (const warning of storage.warnings) console.warn('[storage]', warning)

  registerBooksIpc(ipcMain, storage.library, storage.annotations)
  registerAnnotationsIpc(ipcMain, storage.annotations)
  registerSettingsIpc(ipcMain, openSettings(resolveSettingsFilePath(userDataDir)))
  registerLibraryIpc(ipcMain, {
    repository: storage.library,
    fileStore: new FileBookStore({ userDataDir }),
    dialog,
    getWindow: () => BrowserWindow.getAllWindows()[0] ?? null
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

/**
 * 最后一道兜底。走到这里说明启动链自己出了问题（注册 IPC、建窗口失败），
 * 已经没有可降级的余地；那就宁可弹一个看得懂的框再退出，
 * 也不要留下一个没有窗口、用户也杀不掉的进程。
 */
function reportFatalStartupError(error: unknown): void {
  console.error('[startup] 启动失败', error)
  dialog.showErrorBox('电纸书阅读器启动失败', error instanceof Error ? error.message : String(error))
  app.quit()
}

void app.whenReady().then(startApplication).catch(reportFatalStartupError)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
