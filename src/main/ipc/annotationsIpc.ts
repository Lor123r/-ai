import { join } from 'node:path'
import type { BrowserWindow, Dialog, IpcMain, OpenDialogOptions, SaveDialogOptions } from 'electron'
import { AnnotationTransferFormatError, serializeAnnotationTransfer } from '@core/adapters/annotationTransfer'
import type { Book } from '@core/domain/book'
import { isValidAnnotationId, normalizeAnnotationBookId, reviveAnnotation } from '@core/domain/annotation'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import type { ExportAnnotationsSummary, ImportAnnotationsSummary } from '@core/ports/annotationTransfer'
import type { BookRepository } from '@core/ports/bookRepository'
import { importAnnotations } from '@core/services/importAnnotations'
import { ANNOTATION_CHANNELS, ANNOTATION_FILE_INVALID_MESSAGE, ANNOTATION_TRANSFER_CHANNELS } from '@shared/ipc'
import { annotationFileName, readAnnotationText, writeAnnotationText } from '../transfer/annotationFile'

function requireBookId(value: unknown): string {
  const bookId = normalizeAnnotationBookId(value)
  if (bookId === null) throw new Error('注解所属书籍 id 不合法')
  return bookId
}

/**
 * 删除路径上的 id 必须 trim 后再用。
 * isValidAnnotationId 内部就是 trim 之后判的，直接拿原值当键会让 ' a1 ' 与 'a1'
 * 变成两个不同的条目 —— 渲染层删了却删不掉，或者干脆删出个「不存在」的静默成功。
 */
function requireAnnotationId(value: unknown): string {
  if (!isValidAnnotationId(value)) throw new Error('注解 id 不合法')
  return value.trim()
}

export interface AnnotationsIpcDeps {
  annotations: AnnotationRepository
  /** 交换接口要确认目标书真的存在，见 requireBook。 */
  books: BookRepository
  dialog: Dialog
  /** 文件对话框的宿主窗口，拿不到时退化成非模态框。 */
  getWindow: () => BrowserWindow | null
  /** 另存框的起始目录。注入而不是在这里读 app.getPath，让本模块不依赖 app。 */
  defaultDirectory: string
  /** 应用数据目录，导出目标落在它里面一律拒绝。见 writeAnnotationText。 */
  userDataDir: string
  /** 注入时钟，让导出文件里的 exportedAt 可钉住。 */
  now?: () => number
}

/**
 * 注册注解 IPC。
 * 渲染层的写入路径是乐观更新，这条 id 到主进程时已经在信任边界之外，
 * 所以 save 一律先过 reviveAnnotation（逐字段收敛 + 非法整条拒绝），
 * 而不是把渲染层递来的对象直接落盘。
 *
 * 交换用的两个频道注册在同一处：它们和上面三个共用一份 id 校验与同一个仓储，
 * 拆成两个注册函数只会让 annotationsIpc.test 里那条「注册的频道集合」断言失去意义。
 */
export function registerAnnotationsIpc(ipcMain: IpcMain, deps: AnnotationsIpcDeps): void {
  const { annotations } = deps

  ipcMain.handle(ANNOTATION_CHANNELS.list, (_event, bookId: unknown) =>
    annotations.listByBook(requireBookId(bookId))
  )

  ipcMain.handle(ANNOTATION_CHANNELS.save, (_event, raw: unknown) => {
    const annotation = reviveAnnotation(raw)
    if (!annotation) throw new Error('注解数据不合法')
    return annotations.save(annotation)
  })

  ipcMain.handle(ANNOTATION_CHANNELS.remove, (_event, bookId: unknown, annotationId: unknown) =>
    annotations.remove(requireBookId(bookId), requireAnnotationId(annotationId))
  )

  ipcMain.handle(
    ANNOTATION_TRANSFER_CHANNELS.exportBook,
    async (_event, bookId: unknown): Promise<ExportAnnotationsSummary | null> => {
      const book = await requireBook(deps, bookId)

      // 先读存档再弹另存框。反过来在降级会话里会白弹一次框：用户精心挑完路径才被告知
      // 存档根本读不出来。放在前面还有个副作用 —— 空列表的导出照样能存下一份合法文件，
      // 这是有意的，用户想留个空档案我们也拦不着。
      const existing = await annotations.listByBook(book.id)

      const target = await pickExportTarget(deps, book)
      if (target === null) return null

      await writeAnnotationText(target, serializeAnnotationTransfer(book, existing, (deps.now ?? Date.now)()), {
        mustStayOutside: deps.userDataDir
      })

      return { count: existing.length }
    }
  )

  ipcMain.handle(
    ANNOTATION_TRANSFER_CHANNELS.importInto,
    async (_event, bookId: unknown): Promise<ImportAnnotationsSummary | null> => {
      const book = await requireBook(deps, bookId)

      const source = await pickImportSource(deps)
      if (source === null) return null

      const text = await readAnnotationText(source)

      try {
        return await importAnnotations(text, book.id, { repository: annotations, now: deps.now })
      } catch (caught) {
        // 只把「文件不对」翻译成固定文案，其余（存档不可用、写盘失败）原样抛出去让
        // 渲染层说「请重试」。这两类的可操作性完全不同：一个重试一万次也没用，一个
        // 重试一次多半就好了，糊成一句话等于把用户往错的方向推。
        if (!(caught instanceof AnnotationTransferFormatError)) throw caught

        // 具体原因（版本太新、不是 JSON）只在主进程留痕。IPC 传递会把 message 拼上
        // 一长串内部前缀，不适合直接给用户看。
        console.warn('[annotations] 导入的文件无法识别', caught.message)
        throw new Error(ANNOTATION_FILE_INVALID_MESSAGE)
      }
    }
  )
}

/**
 * 渲染层递来的 bookId 到主进程时已经在信任边界之外，而且要指向书架上真实存在的书。
 *
 * 指向一个不存在的 id 时，注解会写进一份没有任何界面能列出来的孤儿存档 ——
 * 用户以为导入成功了，实际什么也看不到，而且这个错误会一直留在磁盘上。
 * 导出一侧同样要挡：否则用户会得到一份合法但永远没法被导入回来的文件。
 */
async function requireBook(deps: AnnotationsIpcDeps, value: unknown): Promise<Book> {
  const book = await deps.books.get(requireBookId(value))
  if (!book) throw new Error('书籍不存在')
  return book
}

async function pickExportTarget(deps: AnnotationsIpcDeps, book: Book): Promise<string | null> {
  const options: SaveDialogOptions = {
    title: '导出注解',
    buttonLabel: '导出',
    defaultPath: join(deps.defaultDirectory, annotationFileName(book.title)),
    filters: [{ name: '注解文件', extensions: ['json'] }]
  }

  const window = deps.getWindow()
  const result = window
    ? await deps.dialog.showSaveDialog(window, options)
    : await deps.dialog.showSaveDialog(options)

  return result.canceled || !result.filePath ? null : result.filePath
}

async function pickImportSource(deps: AnnotationsIpcDeps): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: '导入注解',
    buttonLabel: '导入',
    filters: [{ name: '注解文件', extensions: ['json'] }],
    properties: ['openFile']
  }

  const window = deps.getWindow()
  const result = window
    ? await deps.dialog.showOpenDialog(window, options)
    : await deps.dialog.showOpenDialog(options)

  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}
