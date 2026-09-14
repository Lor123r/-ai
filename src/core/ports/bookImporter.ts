import type { ImportFailure } from './fileStore'

/** 一次导入的结果摘要，只带数量与失败原因，避免把整本书经 IPC 传两遍。 */
export interface BookImportSummary {
  added: number
  /** 内容与书架中已有书籍相同，被去重跳过的数量。 */
  skipped: number
  failed: ImportFailure[]
}

/**
 * 导入书籍的端口。
 * 文件选择框由主进程弹出，渲染进程无法指定任意路径，
 * 因此实现里不用接收路径参数。
 */
export interface BookImporter {
  /** 让用户挑文件并导入；用户取消选择时返回 null。 */
  pickAndImport(): Promise<BookImportSummary | null>
}
