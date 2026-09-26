import { AnnotationTransferFormatError, serializeAnnotationTransfer } from '@core/adapters/annotationTransfer'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import type { BookRepository } from '@core/ports/bookRepository'
import type { ExportAnnotationsSummary, ImportAnnotationsSummary } from '@core/ports/annotationTransfer'
import { importAnnotations } from '@core/services/importAnnotations'
import { ANNOTATION_FILE_INVALID_MESSAGE } from '@shared/ipc'

/** 与主进程 annotationFileName 保持一致的命名规则。 */
function annotationFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').trim()
  const stem = cleaned.length > 0 ? cleaned : 'annotations'
  return `${stem}.annotations.json`
}

/** 触发一次浏览器下载。 */
function download(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  // 立刻 revoke 会让部分浏览器来不及取数据，让出一轮事件循环再释放
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 弹出文件选择框读一个文本文件；用户取消时返回 null。 */
function pickTextFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    let settled = false
    const finish = (text: string | null): void => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      resolve(text)
    }

    const onFocus = (): void => {
      setTimeout(() => finish(null), 300)
    }

    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        finish(null)
        return
      }

      file
        .text()
        .then((text) => finish(text))
        .catch(() => finish(null))
    }

    window.addEventListener('focus', onFocus, { once: true })
    input.click()
  })
}

export interface WebAnnotationTransferDeps {
  books: BookRepository
  annotations: AnnotationRepository
  now?: () => number
}

/**
 * 浏览器宿主的注解交换。
 *
 * 与主进程的语义完全一致：导出走同一份 serializeAnnotationTransfer，导入走同一个
 * importAnnotations 服务。差别只在「文件怎么进出」—— 桌面端是系统对话框 + 磁盘，
 * 浏览器是下载 + 文件选择框。格式与合并规则一行都没有分叉。
 */
export class WebAnnotationTransfer {
  constructor(private readonly deps: WebAnnotationTransferDeps) {}

  async exportBook(bookId: string): Promise<ExportAnnotationsSummary | null> {
    const book = await this.deps.books.get(bookId)
    if (!book) throw new Error('书籍不存在')

    const existing = await this.deps.annotations.listByBook(book.id)
    const text = serializeAnnotationTransfer(book, existing, (this.deps.now ?? Date.now)())

    download(annotationFileName(book.title), text)
    return { count: existing.length }
  }

  async importInto(bookId: string): Promise<ImportAnnotationsSummary | null> {
    const book = await this.deps.books.get(bookId)
    if (!book) throw new Error('书籍不存在')

    const text = await pickTextFile()
    if (text === null) return null

    try {
      return await importAnnotations(text, book.id, { repository: this.deps.annotations, now: this.deps.now })
    } catch (caught) {
      // 与主进程同款：只把「文件不对」翻译成固定文案，其余原样抛出让渲染层说「请重试」
      if (!(caught instanceof AnnotationTransferFormatError)) throw caught

      console.warn('[annotations] 导入的文件无法识别', caught.message)
      throw new Error(ANNOTATION_FILE_INVALID_MESSAGE)
    }
  }
}
