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
  /**
   * 删除书籍文件；文件不存在时静默返回。
   *
   * 带上 bookId 是为了校验归属。书库存档是用户可改的明文，只校验「路径落在 books/ 内」
   * 挡不住「把 A 的 filePath 改成 B 的路径」——那会删掉 B 的正文，而 B 还留在书架上，
   * 正是这套收尾最想避免的坏状态。归属要看文件名约定，只有实现知道，调用方代劳不了。
   */
  remove(bookId: string, filePath: string): Promise<void>
  /**
   * 删除封面文件；文件不存在时静默返回。
   *
   * 与 remove 分开、而不是给 remove 加一个「这条路径算哪类目录」的参数：越界校验的依据
   * 只能由实现自己决定，让调用方用一个参数指定按哪条根目录校验，等于把安全边界的裁决权
   * 交了出去。分开之后两个方法各自持有自己的根目录，也顺带挡住了「把封面路径交给
   * remove」这类串用。bookId 同样用于校验归属。
   */
  removeCover(bookId: string, coverPath: string): Promise<void>
  exists(filePath: string): Promise<boolean>
}
