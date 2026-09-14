import { compareBooksForShelf, type Book } from '../domain/book'
import type { ReadingLocator } from '../domain/progress'
import type { BookRepository } from '../ports/bookRepository'

/**
 * 内存实现：用于单元测试和尚未接入持久化时的默认实现。
 * 后续的 SQLite 适配器必须通过与之一致的契约测试。
 */
export class InMemoryBookRepository implements BookRepository {
  private readonly books = new Map<string, Book>()
  private readonly locators = new Map<string, ReadingLocator>()

  async list(): Promise<Book[]> {
    return [...this.books.values()].sort(compareBooksForShelf).map((book) => ({ ...book }))
  }

  async get(id: string): Promise<Book | null> {
    const book = this.books.get(id)
    return book ? { ...book } : null
  }

  async save(book: Book): Promise<void> {
    const existing = this.books.get(book.id)
    this.books.set(book.id, existing ? { ...book, addedAt: existing.addedAt } : { ...book })
  }

  async remove(id: string): Promise<void> {
    this.books.delete(id)
    this.locators.delete(id)
  }

  async getLocator(bookId: string): Promise<ReadingLocator | null> {
    const locator = this.locators.get(bookId)
    return locator ? { ...locator } : null
  }

  async saveLocator(bookId: string, locator: ReadingLocator): Promise<void> {
    if (!this.books.has(bookId)) throw new Error(`书籍不存在：${bookId}`)
    this.locators.set(bookId, { ...locator })
  }

  async markOpened(id: string, openedAt: number): Promise<void> {
    const book = this.books.get(id)
    if (!book) throw new Error(`书籍不存在：${id}`)
    this.books.set(id, { ...book, lastOpenedAt: openedAt })
  }
}
