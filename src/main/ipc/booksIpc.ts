import type { IpcMain } from 'electron'
import { reviveBook } from '@core/domain/book'
import { isFiniteNumber, isNonEmptyString } from '@core/domain/guards'
import { reviveLocator } from '@core/domain/progress'
import type { BookRepository } from '@core/ports/bookRepository'
import { BOOK_CHANNELS } from '@shared/ipc'

function requireBookId(value: unknown): string {
  if (!isNonEmptyString(value)) throw new Error('书籍 id 不合法')
  return value.trim()
}

function requireTimestamp(value: unknown): number {
  if (!isFiniteNumber(value) || value < 0) throw new Error('时间戳不合法')
  return Math.round(value)
}

/**
 * 注册书库 IPC。渲染进程传入的数据一律先校验再入库，
 * 避免被篡改的渲染进程把非法数据写进用户书库。
 */
export function registerBooksIpc(ipcMain: IpcMain, repository: BookRepository): void {
  ipcMain.handle(BOOK_CHANNELS.list, () => repository.list())

  ipcMain.handle(BOOK_CHANNELS.get, (_event, bookId: unknown) => repository.get(requireBookId(bookId)))

  ipcMain.handle(BOOK_CHANNELS.save, (_event, raw: unknown) => {
    const book = reviveBook(raw)
    if (!book) throw new Error('书籍数据不合法')
    return repository.save(book)
  })

  ipcMain.handle(BOOK_CHANNELS.remove, (_event, bookId: unknown) => repository.remove(requireBookId(bookId)))

  ipcMain.handle(BOOK_CHANNELS.getLocator, (_event, bookId: unknown) =>
    repository.getLocator(requireBookId(bookId))
  )

  ipcMain.handle(BOOK_CHANNELS.saveLocator, (_event, bookId: unknown, raw: unknown) => {
    const locator = reviveLocator(raw)
    if (!locator) throw new Error('阅读进度数据不合法')
    return repository.saveLocator(requireBookId(bookId), locator)
  })

  ipcMain.handle(BOOK_CHANNELS.markOpened, (_event, bookId: unknown, openedAt: unknown) =>
    repository.markOpened(requireBookId(bookId), requireTimestamp(openedAt))
  )
}
