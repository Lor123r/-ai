import { createBook, detectBookFormat, UNTITLED_BOOK_TITLE, type Book } from '@core/domain/book'
import { mediaTypeForCover } from '@core/domain/cover'
import { readEpub } from '@core/epub/readEpub'
import type { BookImportSummary } from '@core/ports/bookImporter'
import type { ImportFailure } from '@core/ports/fileStore'
import type { BookRepository } from '@core/ports/bookRepository'
import { blobWriter } from './idbBlobStore'

/**
 * 与主进程 importBooks 保持一致的失败文案。
 * 两边文案不同会让「同一个坏文件在桌面端和安卓端报不同的话」，用户无从判断是不是同一个问题。
 */
const UNSUPPORTED_FORMAT_REASON = '暂不支持该文件格式'
const UNREADABLE_EPUB_REASON = '无法解析 EPUB 文件（文件可能已损坏）'
const IMPORT_FAILED_REASON = '导入失败，原因未知'

/**
 * 用 WebCrypto 算内容 sha256，与主进程的 createHash('sha256') 结果一致。
 *
 * 这一点很关键：bookId 是内容摘要，两端算出同一个值，用户把桌面端的书库
 * 迁到安卓端时注解才对得上。WebCrypto 在安全上下文（https / localhost）里才有，
 * 安卓 WebView 加载本地资源属于安全上下文，可用。
 */
async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 书名兜底：用文件名去掉扩展名后的部分，比「未命名书籍」更有用。 */
function fallbackTitle(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  const stem = (dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName).trim()
  return stem.length > 0 ? stem : UNTITLED_BOOK_TITLE
}

/**
 * 弹出文件选择框。
 *
 * 用隐藏的 `<input type="file">` 而不是 File System Access API（showOpenFilePicker）：
 * 后者在安卓 WebView 里没有实现，而 input 元素在所有 WebView 版本里都能唤起系统文件选择器。
 * 这正是「渲染进程拿不到路径」这条边界在浏览器里的自然形态 —— input 只给 File 对象，
 * 本来就没有路径可拿。
 */
function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    // 用户取消时不会触发 change，靠 window 的 focus 事件兜底 resolve 空数组。
    // 不这么做的话，取消一次就会让这个 Promise 永远挂着，后续导入全部失效。
    let settled = false
    const finish = (files: File[]): void => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      resolve(files)
    }

    const onFocus = (): void => {
      // focus 回来时 change 可能还没派发，让出一轮事件循环再判定
      setTimeout(() => finish([]), 300)
    }

    input.onchange = () => finish([...(input.files ?? [])])
    window.addEventListener('focus', onFocus, { once: true })
    input.click()
  })
}

export interface WebImporterDeps {
  books: BookRepository
  now?: () => number
}

/**
 * 浏览器宿主的导入器。
 *
 * 流程与主进程 importBooks 对齐：算内容摘要当 id → 已在书架就跳过 → 抽元数据 →
 * 写正文与封面 → 存书籍记录。单个文件失败只影响自己，其余照常导入。
 */
export class WebBookImporter {
  constructor(private readonly deps: WebImporterDeps) {}

  async pickAndImport(): Promise<BookImportSummary | null> {
    const files = await pickFiles('.epub,.txt,application/epub+zip,text/plain', true)
    if (files.length === 0) return null

    const now = this.deps.now ?? Date.now
    const failed: ImportFailure[] = []
    let added = 0
    let skipped = 0

    for (const file of files) {
      const format = detectBookFormat(file.name)
      if (format === null) {
        failed.push({ sourcePath: file.name, reason: UNSUPPORTED_FORMAT_REASON })
        continue
      }

      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const id = await contentHash(bytes)

        if (await this.deps.books.get(id)) {
          skipped += 1
          continue
        }

        const metadata = format === 'epub' ? await readEpub(bytes) : null
        if (format === 'epub' && metadata === null) {
          failed.push({ sourcePath: file.name, reason: UNREADABLE_EPUB_REASON })
          continue
        }

        await blobWriter.writeContent(id, bytes)
        if (metadata?.cover) {
          await blobWriter.writeCover(id, metadata.cover.bytes, mediaTypeForCover(`cover.${metadata.cover.extension}`))
        }

        const book: Book = createBook(
          {
            id,
            title: metadata?.title ?? fallbackTitle(file.name),
            author: metadata?.author,
            format,
            // 浏览器里没有磁盘路径。存文件名而不是空串：createBook 会拒绝空路径，
            // 而且文件名在排查「这本书是哪来的」时比一个占位符有用。
            filePath: file.name,
            fileSize: bytes.byteLength,
            coverPath: metadata?.cover ? `cover.${metadata.cover.extension}` : null
          },
          now()
        )

        await this.deps.books.save(book)
        added += 1
      } catch (error) {
        console.error(`[import] 导入 ${file.name} 失败：`, error)
        failed.push({
          sourcePath: file.name,
          reason: error instanceof Error && error.message.length > 0 ? error.message : IMPORT_FAILED_REASON
        })
      }
    }

    return { added, skipped, failed }
  }
}
