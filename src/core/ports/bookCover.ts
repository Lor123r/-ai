/** 一张可以交给 <img> 显示的封面。 */
export interface BookCover {
  bytes: Uint8Array
  mediaType: string
}

/**
 * 封面读取端口。
 * 只接受书籍 id 而不是路径：渲染进程无从表达「读磁盘上任意文件」，
 * 具体读哪个文件由主进程查书库后决定。
 */
export interface CoverReader {
  /** 读不到封面（没有封面、文件被删、格式不认识）时返回 null。 */
  read(bookId: string): Promise<BookCover | null>
}
