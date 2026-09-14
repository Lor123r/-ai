/** 书籍正文读取端口；渲染进程只传书籍 id，不传任意磁盘路径。 */
export interface BookContentReader {
  read(bookId: string): Promise<Uint8Array | null>
}
