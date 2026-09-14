import { createHash } from 'node:crypto'
import { detectBookFormat, type BookFormat } from '@core/domain/book'
import type { FileStore, ImportFailure, ImportResult, ImportedFile } from '@core/ports/fileStore'

export interface StoredCover {
  path: string
  bookId: string
  extension: string
  bytes: Uint8Array
}

/**
 * 内存版文件仓库，用来单独测导入流程的业务逻辑。
 * 目录布局与真实实现保持一致（books/、covers/），
 * 这样断言写起来和看真实磁盘一样直观。
 */
export class FakeFileStore implements FileStore {
  readonly sources = new Map<string, Uint8Array>()
  readonly stored = new Map<string, Uint8Array>()
  readonly covers: StoredCover[] = []
  readonly removed: string[] = []
  readonly importFailures = new Map<string, string>()

  addSource(sourcePath: string, bytes: Uint8Array): this {
    this.sources.set(sourcePath, bytes)
    return this
  }

  addTextSource(sourcePath: string, text: string): this {
    return this.addSource(sourcePath, new TextEncoder().encode(text))
  }

  failSource(sourcePath: string, reason: string): this {
    this.importFailures.set(sourcePath, reason)
    return this
  }

  async import(sourcePaths: string[]): Promise<ImportResult> {
    const imported: ImportedFile[] = []
    const failed: ImportFailure[] = []

    for (const sourcePath of sourcePaths) {
      const failureReason = this.importFailures.get(sourcePath)
      if (failureReason) {
        failed.push({ sourcePath, reason: failureReason })
        continue
      }

      const bytes = this.sources.get(sourcePath)
      const format = detectBookFormat(sourcePath)
      if (!bytes || format === null) {
        failed.push({ sourcePath, reason: '源文件不可读' })
        continue
      }

      const contentHash = createHash('sha256').update(bytes).digest('hex')
      const filePath = `books/${contentHash}.${format}`
      this.stored.set(filePath, bytes)
      imported.push({ sourcePath, filePath, fileSize: bytes.byteLength, contentHash, format })
    }

    return { imported, failed }
  }

  async read(filePath: string): Promise<Uint8Array> {
    const bytes = this.stored.get(filePath)
    if (!bytes) throw new Error(`文件不存在：${filePath}`)
    return bytes
  }

  async writeCover(bookId: string, bytes: Uint8Array, extension: string): Promise<string> {
    const path = `covers/${bookId}.${extension}`
    this.covers.push({ path, bookId, extension, bytes })
    return path
  }

  async readCover(coverPath: string): Promise<Uint8Array | null> {
    const cover = this.covers.find((entry) => entry.path === coverPath)
    return cover ? cover.bytes : null
  }

  async remove(filePath: string): Promise<void> {
    this.removed.push(filePath)
    this.stored.delete(filePath)
  }

  async exists(filePath: string): Promise<boolean> {
    return this.stored.has(filePath)
  }

  /** 按扩展名取已落盘的文件，省得测试里自己拼 hash。 */
  storedByFormat(format: BookFormat): string[] {
    return [...this.stored.keys()].filter((path) => path.endsWith(`.${format}`))
  }
}
