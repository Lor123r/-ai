import type { BrowserWindow, Dialog, IpcMain, OpenDialogOptions } from 'electron'
import type { BookImportSummary } from '@core/ports/bookImporter'
import type { BookRepository } from '@core/ports/bookRepository'
import type { FileStore } from '@core/ports/fileStore'
import { importBooks } from '@core/services/importBooks'
import { LIBRARY_CHANNELS } from '@shared/ipc'

export const BOOK_EXTENSIONS = ['epub', 'txt']

export interface LibraryIpcDeps {
  repository: BookRepository
  fileStore: FileStore
  dialog: Dialog
  /** 文件选择框的宿主窗口，拿不到时退化为非模态框。 */
  getWindow: () => BrowserWindow | null
}

/**
 * 注册书库级 IPC。
 * 文件路径完全由主进程的选择框产生，渲染进程只能表达「我要导入」，
 * 不能自己指定要读哪个文件，避免被篡改的页面读取本地任意文件。
 */
export function registerLibraryIpc(ipcMain: IpcMain, deps: LibraryIpcDeps): void {
  ipcMain.handle(LIBRARY_CHANNELS.import, async (): Promise<BookImportSummary | null> => {
    const sourcePaths = await pickBookFiles(deps)
    if (sourcePaths === null) return null

    const report = await importBooks(sourcePaths, {
      fileStore: deps.fileStore,
      repository: deps.repository
    })

    return { added: report.added.length, skipped: report.skipped.length, failed: report.failed }
  })
}

async function pickBookFiles(deps: LibraryIpcDeps): Promise<string[] | null> {
  const options: OpenDialogOptions = {
    title: '导入书籍',
    buttonLabel: '导入',
    filters: [{ name: '电子书', extensions: BOOK_EXTENSIONS }],
    properties: ['openFile', 'multiSelections']
  }

  const window = deps.getWindow()
  const result = window ? await deps.dialog.showOpenDialog(window, options) : await deps.dialog.showOpenDialog(options)

  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths
}
