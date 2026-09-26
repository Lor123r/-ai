import { compareBooksForShelf, reviveBook, type Book } from '@core/domain/book'
import { reviveLocator, type ReadingLocator } from '@core/domain/progress'
import type { BookRepository } from '@core/ports/bookRepository'
import { STORE, getAll, get, put, remove } from './idb'

/**
 * 存在 IndexedDB 里的一行。
 *
 * 进度与元数据放在同一条记录里，而不是各开一个仓：进度是「这本书读到哪了」，
 * 与书本身同生共死（删书必须连进度一起删）。分成两个仓就要靠两段事务维持这个不变式，
 * 而 IndexedDB 的跨仓事务写起来容易漏，漏了就会留下孤儿进度。
 */
interface BookRow {
  id: string
  book: Book
  locator: ReadingLocator | null
}

/**
 * 浏览器宿主的书籍仓库。
 *
 * 读出来的每一行都过一遍 reviveBook / reviveLocator：IndexedDB 里的数据同样可能被
 * 用户用开发者工具改过，或者被旧版本的应用写成另一种形状。与主进程的 JSON 存档
 * 走同一套收敛逻辑，坏掉一条只丢一条，不会让整个书架读不出来。
 */
export class IdbBookRepository implements BookRepository {
  async list(): Promise<Book[]> {
    const rows = await getAll<BookRow>(STORE.books)
    const books: Book[] = []

    for (const row of rows) {
      const book = reviveBook(row?.book)
      if (book) books.push(book)
    }

    return books.sort(compareBooksForShelf)
  }

  async get(id: string): Promise<Book | null> {
    const row = await get<BookRow>(STORE.books, id)
    return reviveBook(row?.book)
  }

  async save(book: Book): Promise<void> {
    const existing = await get<BookRow>(STORE.books, book.id)
    // addedAt 保持首次导入的时间：重新导入同一本书时不该把它顶到书架最前面
    const merged = existing ? { ...book, addedAt: existing.book.addedAt } : book

    await put(STORE.books, { id: book.id, book: merged, locator: existing?.locator ?? null } satisfies BookRow)
  }

  async remove(id: string): Promise<void> {
    await remove(STORE.books, id)
  }

  async getLocator(bookId: string): Promise<ReadingLocator | null> {
    const row = await get<BookRow>(STORE.books, bookId)
    return reviveLocator(row?.locator)
  }

  async saveLocator(bookId: string, locator: ReadingLocator): Promise<void> {
    const row = await get<BookRow>(STORE.books, bookId)
    // 与 InMemoryBookRepository 一致：给不存在的书写进度是调用方的 bug，直接抛
    if (!row) throw new Error(`书籍不存在：${bookId}`)

    await put(STORE.books, { ...row, locator } satisfies BookRow)
  }

  async markOpened(id: string, openedAt: number): Promise<void> {
    const row = await get<BookRow>(STORE.books, id)
    if (!row) throw new Error(`书籍不存在：${id}`)

    await put(STORE.books, { ...row, book: { ...row.book, lastOpenedAt: openedAt } } satisfies BookRow)
  }
}
