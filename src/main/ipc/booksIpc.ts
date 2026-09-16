import type { IpcMain } from 'electron'
import { reviveBook } from '@core/domain/book'
import { isFiniteNumber, isNonEmptyString } from '@core/domain/guards'
import { reviveLocator } from '@core/domain/progress'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
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
 * 删书：先把书从书库摘掉，再顺手清掉这本书的注解。
 *
 * 顺序不可交换。反序（先清注解、再删书）时删书一旦失败，就留下「书还在、书签与
 * 划线全没了」——那是拿不回来的真数据丢失；正序失败最多留下几份孤儿注解，用户
 * 还能在重新导入之后一条条删掉。书库与注解是两份独立的存档、跨文件没有事务，
 * 所以这个顺序只能在主进程里靠这一个函数保证。
 *
 * 清注解是尽力而为：降级启动时注解仓储是 UnavailableAnnotationRepository，
 * removeByBook 必定 reject。这里必须吞掉它，否则一次已经落盘的删书会被渲染层
 * 报成失败，用户会去删第二遍 —— 而第二遍什么也删不掉。书已经没了，剩下的注解
 * 不会再出现在任何界面上。
 */
async function removeBookWithAnnotations(
  bookId: string,
  repository: BookRepository,
  annotations: AnnotationRepository
): Promise<void> {
  await repository.remove(bookId)

  try {
    await annotations.removeByBook(bookId)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[books] 书籍 ${bookId} 已删除，但它的注解没能一并清掉：${reason}`)
  }
}

/**
 * 注册书库 IPC。渲染进程传入的数据一律先校验再入库，
 * 避免被篡改的渲染进程把非法数据写进用户书库。
 *
 * annotations 只服务于删书这一条路径 —— 它是书库与注解存档唯一必须一起改的地方。
 */
export function registerBooksIpc(
  ipcMain: IpcMain,
  repository: BookRepository,
  annotations: AnnotationRepository
): void {
  ipcMain.handle(BOOK_CHANNELS.list, () => repository.list())

  ipcMain.handle(BOOK_CHANNELS.get, (_event, bookId: unknown) => repository.get(requireBookId(bookId)))

  ipcMain.handle(BOOK_CHANNELS.save, (_event, raw: unknown) => {
    const book = reviveBook(raw)
    if (!book) throw new Error('书籍数据不合法')
    return repository.save(book)
  })

  ipcMain.handle(BOOK_CHANNELS.remove, (_event, bookId: unknown) =>
    removeBookWithAnnotations(requireBookId(bookId), repository, annotations)
  )

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
