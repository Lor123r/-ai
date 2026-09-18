import { createBook, detectBookFormat, UNTITLED_BOOK_TITLE, type Book } from '../domain/book'
import type { FileStore, ImportFailure, ImportedFile } from '../ports/fileStore'
import type { BookRepository } from '../ports/bookRepository'
import { readEpub, type EpubMetadata } from '../epub/readEpub'

export interface ImportReport {
  /** 本次真正加入书架的书籍。 */
  added: Book[]
  /** 内容与书架中已有书籍相同，因而不重复导入。 */
  skipped: Book[]
  failed: ImportFailure[]
}

export interface ImportBooksDeps {
  fileStore: FileStore
  repository: BookRepository
  now?: () => number
}

export const UNSUPPORTED_FORMAT_REASON = '暂不支持该文件格式'
export const UNREADABLE_EPUB_REASON = '无法解析 EPUB 文件（文件可能已损坏）'
/** 兜底文案：走到这里说明连错误对象都没取到，只有实现抛了非 Error 的东西才会发生。 */
export const IMPORT_FAILED_REASON = '导入失败，原因未知'

/** loadMetadata 的三种结局：读到、字节是坏的、压根读不出来。 */
type MetadataResult =
  | { status: 'ok'; metadata: EpubMetadata | null }
  | { status: 'broken'; reason: string }
  | { status: 'unreadable'; reason: string }

/**
 * 导入用户选中的文件：复制进书库、抽取元数据、写进书架。
 * 用内容摘要当 id，所以同一本书重复导入只会被跳过，不会产生副本。
 * 单个文件失败只影响自己，其余文件照常导入；失败时把这次复制进来的文件撤掉，
 * 免得书库目录里留下书架上看不到的字节。
 */
export async function importBooks(sourcePaths: string[], deps: ImportBooksDeps): Promise<ImportReport> {
  const now = deps.now ?? Date.now
  const report: ImportReport = { added: [], skipped: [], failed: [] }

  const supported: string[] = []
  for (const sourcePath of sourcePaths) {
    if (detectBookFormat(sourcePath) === null) {
      report.failed.push({ sourcePath, reason: UNSUPPORTED_FORMAT_REASON })
    } else {
      supported.push(sourcePath)
    }
  }

  const copied = await deps.fileStore.import(supported)
  report.failed.push(...copied.failed)

  for (const file of copied.imported) {
    // 写在 try 外面，异常处理里才知道有没有落下一张要撤的封面
    let coverPath: string | null = null

    try {
      const existing = await deps.repository.get(file.contentHash)
      if (existing) {
        report.skipped.push(existing)
        continue
      }

      const loaded = await loadMetadata(deps.fileStore, file)
      if (loaded.status !== 'ok') {
        // 字节是坏的才撤文件；读不出来未必是文件的问题，留着比删掉安全
        if (loaded.status === 'broken') await discard(file, null, deps)
        report.failed.push({ sourcePath: file.sourcePath, reason: loaded.reason })
        continue
      }

      coverPath = loaded.metadata?.cover
        ? await deps.fileStore.writeCover(file.contentHash, loaded.metadata.cover.bytes, loaded.metadata.cover.extension)
        : null

      const book = createBook(
        {
          id: file.contentHash,
          title: loaded.metadata?.title ?? fallbackTitle(file.sourcePath),
          author: loaded.metadata?.author,
          format: file.format,
          filePath: file.filePath,
          fileSize: file.fileSize,
          coverPath
        },
        now()
      )

      await deps.repository.save(book)
      report.added.push(book)
    } catch (error) {
      // 没有这层兜底，一个文件写盘失败会把整批导入带停，与「只影响自己」的承诺不符
      console.error(`[import] 导入 ${file.sourcePath} 失败：`, error)
      await discard(file, coverPath, deps)
      report.failed.push({ sourcePath: file.sourcePath, reason: describeFailure(error, IMPORT_FAILED_REASON) })
    }
  }

  return report
}

/**
 * 抽取元数据。读取失败与解析失败必须分开归类：
 * 读不出来是 IO 故障或路径越界，文件本身未必有问题；解析失败才是「字节确实不是一本能读的
 * EPUB」。两者都报成「文件可能已损坏」，就会在文件其实没坏的时候把它删掉，还把人引向重新下载。
 */
async function loadMetadata(fileStore: FileStore, file: ImportedFile): Promise<MetadataResult> {
  if (file.format !== 'epub') return { status: 'ok', metadata: null }

  let bytes: Uint8Array
  try {
    bytes = await fileStore.read(file.filePath)
  } catch (error) {
    return { status: 'unreadable', reason: describeFailure(error, UNREADABLE_EPUB_REASON) }
  }

  const metadata = await readEpub(bytes)
  if (metadata === null) return { status: 'broken', reason: UNREADABLE_EPUB_REASON }

  return { status: 'ok', metadata }
}

/**
 * 撤掉一次失败导入留下的文件。
 *
 * 两道门都得过才动手：
 * 1. file.created —— 复用的是书库里已有的文件时，它不是这次的产物，删了会连带删掉
 *    另一本在册书籍的正文；
 * 2. 复查书库 —— 存档实现先改内存再落盘，落盘失败时书其实已经进库了，此时删文件就会留下
 *    「书架上有条目、点开读不了」的坏状态，比占盘严重得多。
 */
async function discard(file: ImportedFile, coverPath: string | null, deps: ImportBooksDeps): Promise<void> {
  if (!file.created) return
  if (await isInLibrary(file.contentHash, deps)) return

  await bestEffort(() => deps.fileStore.remove(file.contentHash, file.filePath))
  if (coverPath !== null) await bestEffort(() => deps.fileStore.removeCover(file.contentHash, coverPath))
}

/** 复查失败时按「书还在库里」处理：宁可留下一个孤儿文件，也别删掉可能还在册的正文。 */
async function isInLibrary(bookId: string, deps: ImportBooksDeps): Promise<boolean> {
  try {
    return (await deps.repository.get(bookId)) !== null
  } catch {
    return true
  }
}

/**
 * 清理本身再失败只留痕。调用方已经要把这次导入记成 failed，再抛一个错出去，
 * 只会让「导入了几个文件」这种报告变成一次整体失败。
 */
async function bestEffort(cleanup: () => Promise<void>): Promise<void> {
  try {
    await cleanup()
  } catch (error) {
    console.warn(`[import] 失败导入的残留文件没能清掉：${describeFailure(error, IMPORT_FAILED_REASON)}`)
  }
}

/**
 * 失败原因照实透出。写死一句「保存书籍信息失败」会把封面写失败、书库读失败都算到同一条上，
 * 而这几件事该做的事正好相反：封面失败要撤掉正文，读失败不能撤。
 */
function describeFailure(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback
}

/** 书名兜底：用文件名去掉扩展名后的部分，比「未命名书籍」更有用。 */
function fallbackTitle(sourcePath: string): string {
  const fileName = sourcePath.split(/[\\/]/).pop() ?? ''
  const dotIndex = fileName.lastIndexOf('.')
  const stem = (dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName).trim()

  return stem.length > 0 ? stem : UNTITLED_BOOK_TITLE
}
