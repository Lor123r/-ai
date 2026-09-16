import { createBook, detectBookFormat, UNTITLED_BOOK_TITLE, type Book } from '../domain/book'
import type { FileStore, ImportFailure } from '../ports/fileStore'
import type { BookRepository } from '../ports/bookRepository'
import { readEpub } from '../epub/readEpub'

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

/**
 * 导入用户选中的文件：复制进书库、抽取元数据、写进书架。
 * 用内容摘要当 id，所以同一本书重复导入只会被跳过，不会产生副本。
 * 单个文件失败只影响自己，其余文件照常导入。
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
    const existing = await deps.repository.get(file.contentHash)
    if (existing) {
      report.skipped.push(existing)
      continue
    }

    const metadata = file.format === 'epub' ? await readEpubSafe(deps.fileStore, file.filePath) : null
    if (file.format === 'epub' && metadata === null) {
      // 复制进来的坏文件要清掉，避免书库目录里堆垃圾。
      // bookId 在这里就是内容摘要，删除要过归属校验
      await deps.fileStore.remove(file.contentHash, file.filePath)
      report.failed.push({ sourcePath: file.sourcePath, reason: UNREADABLE_EPUB_REASON })
      continue
    }

    const coverPath = metadata?.cover
      ? await deps.fileStore.writeCover(file.contentHash, metadata.cover.bytes, metadata.cover.extension)
      : null

    const book = createBook(
      {
        id: file.contentHash,
        title: metadata?.title ?? fallbackTitle(file.sourcePath),
        author: metadata?.author,
        format: file.format,
        filePath: file.filePath,
        fileSize: file.fileSize,
        coverPath
      },
      now()
    )

    await deps.repository.save(book)
    report.added.push(book)
  }

  return report
}

async function readEpubSafe(fileStore: FileStore, filePath: string) {
  try {
    return await readEpub(await fileStore.read(filePath))
  } catch {
    return null
  }
}

/** 书名兜底：用文件名去掉扩展名后的部分，比「未命名书籍」更有用。 */
function fallbackTitle(sourcePath: string): string {
  const fileName = sourcePath.split(/[\\/]/).pop() ?? ''
  const dotIndex = fileName.lastIndexOf('.')
  const stem = (dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName).trim()

  return stem.length > 0 ? stem : UNTITLED_BOOK_TITLE
}
