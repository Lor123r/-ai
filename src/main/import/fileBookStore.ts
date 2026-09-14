import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { detectBookFormat } from '@core/domain/book'
import type { FileStore, ImportResult, ImportedFile } from '@core/ports/fileStore'

export const BOOKS_DIR_NAME = 'books'
export const COVERS_DIR_NAME = 'covers'

/** 单本书的大小上限，防止误选超大文件把内存打满。 */
export const MAX_BOOK_FILE_SIZE = 512 * 1024 * 1024

export interface FileBookStoreOptions {
  userDataDir: string
  /** 读取字节的上限，测试里可以调小。 */
  maxFileSize?: number
}

/**
 * 书库文件的真实落盘实现。
 * 导入时把用户选中的文件复制进 <userData>/books，
 * 文件名用内容 sha256，因此同一本书重复导入就是同一个文件，天然去重；
 * 封面写到 <userData>/covers。
 * 所有按路径操作的接口都只允许访问书库自己的目录，
 * 避免存档被篡改后拿着任意路径去读写磁盘。
 */
export class FileBookStore implements FileStore {
  private readonly booksDir: string
  private readonly coversDir: string
  private readonly maxFileSize: number

  constructor(options: FileBookStoreOptions) {
    this.booksDir = join(options.userDataDir, BOOKS_DIR_NAME)
    this.coversDir = join(options.userDataDir, COVERS_DIR_NAME)
    this.maxFileSize = options.maxFileSize ?? MAX_BOOK_FILE_SIZE
  }

  getBooksDir(): string {
    return this.booksDir
  }

  getCoversDir(): string {
    return this.coversDir
  }

  async import(sourcePaths: string[]): Promise<ImportResult> {
    const result: ImportResult = { imported: [], failed: [] }

    for (const sourcePath of sourcePaths) {
      try {
        result.imported.push(await this.copyIn(sourcePath))
      } catch (error) {
        result.failed.push({ sourcePath, reason: describeError(error) })
      }
    }

    return result
  }

  async read(filePath: string): Promise<Uint8Array> {
    const target = this.requireInside(this.booksDir, filePath)
    return new Uint8Array(await readFile(target))
  }

  async writeCover(bookId: string, bytes: Uint8Array, extension: string): Promise<string> {
    const name = safeFileStem(bookId)
    const target = join(this.coversDir, `${name}.${safeExtension(extension)}`)

    await mkdir(this.coversDir, { recursive: true })
    await writeAtomically(target, bytes)
    return target
  }

  async readCover(coverPath: string): Promise<Uint8Array | null> {
    const target = this.requireInside(this.coversDir, coverPath)

    try {
      return new Uint8Array(await readFile(target))
    } catch {
      // 封面文件可能被用户手工删掉，读不到不该让书架报错
      return null
    }
  }

  async remove(filePath: string): Promise<void> {
    const target = this.requireInside(this.booksDir, filePath)
    await rm(target, { force: true })
  }

  async exists(filePath: string): Promise<boolean> {
    const target = this.resolveInside(this.booksDir, filePath)
    if (target === null) return false

    try {
      return (await stat(target)).isFile()
    } catch {
      return false
    }
  }

  private async copyIn(sourcePath: string): Promise<ImportedFile> {
    const format = detectBookFormat(sourcePath)
    if (format === null) throw new Error('暂不支持该文件格式')

    const info = await stat(sourcePath)
    if (!info.isFile()) throw new Error('不是一个文件')
    if (info.size > this.maxFileSize) throw new Error('文件过大')
    if (info.size === 0) throw new Error('文件是空的')

    const bytes = await readFile(sourcePath)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const target = join(this.booksDir, `${contentHash}.${format}`)

    // 同一本书已经导入过就不必重复复制，但仍然返回结果让上层去重
    if (!(await this.exists(target))) {
      await mkdir(this.booksDir, { recursive: true })
      await writeAtomically(target, bytes)
    }

    return { sourcePath, filePath: target, fileSize: bytes.byteLength, contentHash, format }
  }

  /** 路径必须落在书库目录内，否则一律拒绝，防止越界读写。 */
  private requireInside(root: string, target: string): string {
    const resolvedTarget = this.resolveInside(root, target)
    if (resolvedTarget === null) throw new Error('文件不在书库目录内')
    return resolvedTarget
  }

  private resolveInside(root: string, target: string): string | null {
    const resolvedRoot = resolve(root)
    const resolvedTarget = resolve(target)

    if (resolvedTarget === resolvedRoot) return null
    return resolvedTarget.startsWith(resolvedRoot + sep) ? resolvedTarget : null
  }
}

/** 先写临时文件再改名，避免中途被强杀留下半截文件。 */
async function writeAtomically(target: string, bytes: Uint8Array): Promise<void> {
  const tempPath = `${target}.tmp`
  await writeFile(tempPath, bytes)
  await rename(tempPath, target)
}

function safeFileStem(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '')
  if (cleaned.length === 0) throw new Error('非法的文件标识')
  return cleaned
}

function safeExtension(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (cleaned.length === 0) throw new Error('非法的文件扩展名')
  return cleaned
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return '文件导入失败'
}
