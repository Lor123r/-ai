/**
 * 一次导入的结果摘要。
 *
 * 刻意只带计数，一个路径都不回传：用户刚在系统对话框里亲手选的路径不需要应用再念一遍，
 * 这样「渲染进程只能拿到 bookId」这条边界就是结构性成立的，而不是靠 showOpenDialog /
 * showSaveDialog 的实现替我们保证。仓库已有先例：BookImportSummary 同样只回数量与原因。
 */
export interface ImportAnnotationsSummary {
  /** 真正写进存档的条数。 */
  added: number
  /** 目标书里已有同 id、或文件内部重复，因而没有写入的条数。 */
  skipped: number
  /** 条目字段非法被丢弃的条数 —— 是文件里的数据有问题。 */
  dropped: number
  /** 因为这本书的注解已达上限而没写进去的条数 —— 是书架满了，与数据好坏无关。 */
  trimmed: number
  /** 文件里的书籍标识与目标书不同，条目是按内容归到这本书上的。 */
  fromOtherBook: boolean
}

export interface ExportAnnotationsSummary {
  count: number
}

/**
 * 注解交换端口。
 *
 * 保存与选择对话框一律由主进程弹出，渲染进程既不能指定路径也拿不到路径，
 * 因此实现里既不接收也不返回路径参数（与 BookImporter 同款）。
 */
export interface AnnotationTransfer {
  /** 把这本书的注解导出成文件；用户取消选择时返回 null。 */
  exportBook(bookId: string): Promise<ExportAnnotationsSummary | null>
  /** 把交换文件里的注解并进这本书；用户取消选择时返回 null。 */
  importInto(bookId: string): Promise<ImportAnnotationsSummary | null>
}
