import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
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
 * 路径越界与归属不符时抛出。
 *
 * 与 IO 故障分成两类的原因在调用方：越界路径只可能来自被改过的存档或者代码 bug，
 * 属于必须让人看见的问题；而文件被占用之类的临时故障重试一次多半就好了。两者都
 * 混在普通 Error 里，调用方只能按文案猜，日志级别也就无从判起。
 */
export class FileStoreBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileStoreBoundaryError'
  }
}

export function isFileStoreBoundaryError(error: unknown): error is FileStoreBoundaryError {
  return error instanceof FileStoreBoundaryError
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

  /**
   * 删除书籍文件；文件不存在时静默返回。
   *
   * rm 永远不带 recursive，也不先用 stat 预判类型：失败模式比成功模式重要。
   * 不带 recursive 时，目标若是目录会抛 ERR_FS_EISDIR 且内部文件完好，
   * 所以存档被改成一条指向目录的路径最坏只是删不掉，不存在连子树一起删的可能。
   */
  async remove(bookId: string, filePath: string): Promise<void> {
    const target = this.requireInside(this.booksDir, filePath)
    this.requireOwned(bookId, target)
    await rm(target, { force: true })
  }

  async removeCover(bookId: string, coverPath: string): Promise<void> {
    const target = this.requireInside(this.coversDir, coverPath)
    this.requireOwned(bookId, target)
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
    let created = false
    if (!(await this.exists(target))) {
      await mkdir(this.booksDir, { recursive: true })
      await writeAtomically(target, bytes)
      created = true
    }

    return { sourcePath, filePath: target, fileSize: bytes.byteLength, contentHash, format, created }
  }

  /** 路径必须落在书库目录内，否则一律拒绝，防止越界读写。 */
  private requireInside(root: string, target: string): string {
    const resolvedTarget = this.resolveInside(root, target)
    if (resolvedTarget === null) throw new FileStoreBoundaryError('文件不在书库目录内')
    return resolvedTarget
  }

  /**
   * 归属校验：路径除了要在库内，还得真的是这本书的文件。
   *
   * 越界校验挡的是「跑到书库外面去」，挡不住「跑到同一目录里别人的文件上」。
   * library.json 是可改明文，把 A 的 filePath 写成 books/<B 的 sha256>.epub，
   * 四项路径检查全部通过——删掉的是 B 的正文，而 B 还留在书架上打不开。
   * 命名约定（books/ 下是 <内容摘要>.<格式>，covers/ 下是 <摘要去符号>.<图片格式>）
   * 由本实现定，所以这条校验也只能在这里做。
   *
   * 用「<摘要>.」做前缀而比对而不是拼完整文件名：扩展名由输入格式和图片格式决定，
   * 硬编码一份扩展名清单迟早和 writeCover / copyIn 走散。带点的前缀不会误伤
   * 「摘要是另一个的前缀」这种情况。
   */
  private requireOwned(bookId: string, target: string): void {
    if (!basename(target).startsWith(`${safeFileStem(bookId)}.`)) {
      throw new FileStoreBoundaryError('文件不属于这本书')
    }
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

/**
 * 摘要之外的字符一律剔掉，保证拼出来的文件名不会跑到目录外面去。
 *
 * 洗不干净只可能是存档被改过或者调用方传了脏值（书籍 id 取自内容摘要，正常永远是
 * 十六进制），所以按边界错误抛，让调用方按 error 级别记下来。
 */
function safeFileStem(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '')
  if (cleaned.length === 0) throw new FileStoreBoundaryError('非法的文件标识')
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
