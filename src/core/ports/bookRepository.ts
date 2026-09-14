import type { Book } from '../domain/book'
import type { ReadingLocator } from '../domain/progress'

/**
 * 书籍与阅读进度的持久化端口。
 * UI 只依赖这个接口，具体实现可以是内存、SQLite 或主进程 IPC。
 * list() 必须按 compareBooksForShelf 的顺序返回。
 */
export interface BookRepository {
  list(): Promise<Book[]>
  get(id: string): Promise<Book | null>
  save(book: Book): Promise<void>
  remove(id: string): Promise<void>
  getLocator(bookId: string): Promise<ReadingLocator | null>
  saveLocator(bookId: string, locator: ReadingLocator): Promise<void>
  markOpened(id: string, openedAt: number): Promise<void>
}
