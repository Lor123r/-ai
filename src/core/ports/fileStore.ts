import type { BookFormat } from '../domain/book'

export interface ImportedFile {
  /** 用户选中的原始路径，用于在导入报告里指明是哪个文件。 */
  sourcePath: string
  /** 复制进书库后的绝对路径。 */
  filePath: string
  fileSize: number
  /** 文件内容摘要，用作书籍 id，保证同一本书重复导入时不会产生副本。 */
  contentHash: string
  format: BookFormat
}

export interface ImportFailure {
  sourcePath: string
  reason: string
}

export interface ImportResult {
  imported: ImportedFile[]
  failed: ImportFailure[]
}

/** 书籍文件的落盘端口，由主进程实现。 */
export interface FileStore {
  /** 把用户选中的文件复制进应用书库目录并计算摘要。 */
  import(sourcePaths: string[]): Promise<ImportResult>
  /** 读取书库内某个文件的字节，用于解析元数据。 */
  read(filePath: string): Promise<Uint8Array>
  /** 写入封面图，返回它在磁盘上的位置。 */
  writeCover(bookId: string, bytes: Uint8Array, extension: string): Promise<string>
  /** 读取封面字节；文件不存在时返回 null 而不是抛错。 */
  readCover(coverPath: string): Promise<Uint8Array | null>
  remove(filePath: string): Promise<void>
  exists(filePath: string): Promise<boolean>
}
