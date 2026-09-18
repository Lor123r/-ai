import type { IpcMain } from 'electron'
import { reviveBook } from '@core/domain/book'
import { isFiniteNumber, isNonEmptyString } from '@core/domain/guards'
import { reviveLocator } from '@core/domain/progress'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import type { BookRepository } from '@core/ports/bookRepository'
import type { FileStore } from '@core/ports/fileStore'
import { BOOK_CHANNELS } from '@shared/ipc'
import { isFileStoreBoundaryError } from '../import/fileBookStore'
import { ANNOTATIONS_UNAVAILABLE_MESSAGE } from '../storage/unavailableAnnotationRepository'

function requireBookId(value: unknown): string {
  if (!isNonEmptyString(value)) throw new Error('书籍 id 不合法')
  return value.trim()
}

function requireTimestamp(value: unknown): number {
  if (!isFiniteNumber(value) || value < 0) throw new Error('时间戳不合法')
  return Math.round(value)
}

/** removeBookWithAnnotations 需要的三个主进程能力。 */
export interface BooksIpcDeps {
  repository: BookRepository
  annotations: AnnotationRepository
  fileStore: FileStore
}

/**
 * 删书：先把书从书库摘掉，再顺手清掉这本书的注解与它在磁盘上占的两个文件。
 *
 * 三条收尾的先后顺序都由同一条原则决定 —— 让失败停在不那么疼的地方：
 *
 * 1. 取路径必须在 repository.remove 之前。remove 之后存档里就没有这本书了，
 *    filePath 与 coverPath 也跟着没了，而回收文件恰恰需要它们。
 *
 * 2. 先删书、后删注解。反序（先清注解、再删书）时删书一旦失败，就留下「书还在、
 *    书签与划线全没了」——那是拿不回来的真数据丢失；正序失败最多留下几份孤儿注解，
 *    用户还能在重新导入之后一条条删掉。书库与注解是两份独立的存档、跨文件没有事务，
 *    所以这个顺序只能在主进程里靠这一个函数保证。
 *
 *    措辞上的分寸：这里的「删书失败」指 remove 抛错，此时函数立即中止，磁盘上的
 *    epub 与封面一定没动。但两份存档之间没有事务：remove 成功之后注解仍然可能清不掉，
 *    那是这一步的性质，靠顺序兜不住，只能尽力而为 + 留痕。
 *
 * 3. 数据全部落定之后才回收文件。删了文件但书还在书库里，会留下「书架上有条目、
 *    点开读不了」的坏状态，比占盘严重得多；反过来最坏只是留下几个没人引用的文件
 *    （bookId 是文件内容的 sha256，重新导入同一个文件会复用同一个路径）。
 *
 * 三条收尾都是尽力而为，失败只留痕。书已经删掉了，这时候再把失败抛回渲染层，只会
 * 让界面宣称「删除失败」，而用户重试也删不掉一本已经不存在的书。降级启动时注解仓储是
 * UnavailableAnnotationRepository，它的 removeByBook 必定 reject；fileStore 的越界与
 * 归属校验也会在存档被改坏时抛错 —— 两种都得留在主进程日志里，而不是变成一次假的
 * 删除失败。
 *
 * 留痕要分级（见 cleanupLogLevel）：文件被占用这类重试一次就好的按 warn 记，存档被改坏
 * 那种只可能是代码或数据出了问题的按 error 记。全都按 warn 记的话，最该被看见的越界
 * 路径会混在正常的占用提示里，事后根本挑不出来。
 */
async function removeBookWithAnnotations(bookId: string, deps: BooksIpcDeps): Promise<void> {
  const { repository, annotations, fileStore } = deps
  const book = await repository.get(bookId)

  await repository.remove(bookId)

  const bestEffort = async (
    label: string,
    cleanup: () => Promise<void>,
    benignMessages: readonly string[] = []
  ): Promise<void> => {
    try {
      await cleanup()
    } catch (error) {
      const message = `[books] 书籍 ${bookId} 已删除，但${label}没能一并清掉：${describeError(error)}`
      if (cleanupLogLevel(error, benignMessages) === 'warn') console.warn(message)
      else console.error(message)
    }
  }

  await bestEffort(
    '它的注解',
    () => annotations.removeByBook(bookId).then(() => undefined),
    [ANNOTATIONS_UNAVAILABLE_MESSAGE]
  )

  // 存档里没有这本书（例如删一个已经不存在的 id）时没有文件可回收
  if (!book) return

  await bestEffort('它的书籍文件', () => fileStore.remove(bookId, book.filePath))

  // 封面与书籍文件各自独立收尾：封面删不掉不该妨碍回收更占地方的 epub
  const { coverPath } = book
  if (coverPath !== null) {
    await bestEffort('它的封面', () => fileStore.removeCover(bookId, coverPath))
  }
}

/**
 * 清尾失败的日志级别。
 *
 * 默认是 error，只把有把握的原因降成 warn —— 反过来记（默认 warn、认得出才升 error）
 * 会让「认不出」的错误一路静音，而那恰恰是最需要被人看见的一类。
 */
function cleanupLogLevel(error: unknown, benignMessages: readonly string[]): 'warn' | 'error' {
  // 存档被改坏与磁盘临时故障都会带 message，所以边界错误先按类型排掉：
  // 「文件不在书库目录内」这种话无论如何都不该被降级成 warn
  if (isFileStoreBoundaryError(error)) return 'error'

  // 刻意降级的状态（降级启动时注解仓储不可用）说明得来由，按 warn 记不算丢线索
  if (error instanceof Error && benignMessages.includes(error.message)) return 'warn'

  // 占用、权限、空间不足这类问题重试一次多半就好
  const code = errorCode(error)
  return code !== null && BENIGN_CLEANUP_CODES.has(code) ? 'warn' : 'error'
}

/** 常见的、重试一下就好转的磁盘错误码。 */
const BENIGN_CLEANUP_CODES = new Set(['EBUSY', 'EACCES', 'EPERM', 'ENOENT', 'ENOSPC'])

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  const { code } = error as { code?: unknown }
  return typeof code === 'string' ? code : null
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 注册书库 IPC。渲染进程传入的数据一律先校验再入库，
 * 避免被篡改的渲染进程把非法数据写进用户书库。
 *
 * annotations 只服务于删书这一条路径 —— 它是书库与注解存档唯一必须一起改的地方。
 * fileStore 同理：只有删书会真的动磁盘上的文件，其余操作都走导入流程。
 *
 * 三个依赖收成一个对象，与 registerLibraryIpc 对齐：这层认的是「一组主进程能力」，
 * 以后再添一样不用改调用点的位置参数顺序。
 */
export function registerBooksIpc(ipcMain: IpcMain, deps: BooksIpcDeps): void {
  const { repository } = deps

  ipcMain.handle(BOOK_CHANNELS.list, () => repository.list())

  ipcMain.handle(BOOK_CHANNELS.get, (_event, bookId: unknown) => repository.get(requireBookId(bookId)))

  ipcMain.handle(BOOK_CHANNELS.save, (_event, raw: unknown) => {
    const book = reviveBook(raw)
    if (!book) throw new Error('书籍数据不合法')
    return repository.save(book)
  })

  ipcMain.handle(BOOK_CHANNELS.remove, (_event, bookId: unknown) =>
    removeBookWithAnnotations(requireBookId(bookId), deps)
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
