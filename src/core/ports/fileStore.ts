import type { BookFormat } from '../domain/book'

export interface ImportedFile {
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
  remove(filePath: string): Promise<void>
  exists(filePath: string): Promise<boolean>
}
