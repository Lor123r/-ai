import { compareBooksForShelf, type Book } from '../domain/book'
import type { ReadingLocator } from '../domain/progress'
import type { BookRepository } from '../ports/bookRepository'
import type { TextStore } from '../ports/textStore'
import { parseLibrary, serializeLibrary } from './librarySnapshot'

/**
 * 把整个书库写成一份 JSON 文本。
 * 所有读写都串行化（单用户场景下足够），避免并发保存互相覆盖。
 */
export class JsonBookRepository implements BookRepository {
  private books = new Map<string, Book>()
  private locators = new Map<string, ReadingLocator>()
  private loaded = false
  private lock: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: TextStore,
    private readonly now: () => number = Date.now
  ) {}

  /** 显式预读；损坏时会抛出 LibraryCorruptError。 */
  async load(): Promise<void> {
    await this.runExclusive(async () => this.ensureLoaded())
  }

  async list(): Promise<Book[]> {
    return this.runExclusive(async () => {
      await this.ensureLoaded()
      return [...this.books.values()].sort(compareBooksForShelf).map((book) => ({ ...book }))
    })
  }

  async get(id: string): Promise<Book | null> {
    return this.runExclusive(async () => {
      await this.ensureLoaded()
      const book = this.books.get(id)
      return book ? { ...book } : null
    })
  }

  async save(book: Book): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded()
      const existing = this.books.get(book.id)
      this.books.set(book.id, existing ? { ...book, addedAt: existing.addedAt } : { ...book })
      await this.flush()
    })
  }

  async remove(id: string): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded()
      this.books.delete(id)
      this.locators.delete(id)
      await this.flush()
    })
  }

  async getLocator(bookId: string): Promise<ReadingLocator | null> {
    return this.runExclusive(async () => {
      await this.ensureLoaded()
      return this.locators.get(bookId) ?? null
    })
  }

  async saveLocator(bookId: string, locator: ReadingLocator): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded()
      if (!this.books.has(bookId)) throw new Error(`书籍不存在：${bookId}`)
      this.locators.set(bookId, { ...locator })
      await this.flush()
    })
  }

  async markOpened(id: string, openedAt: number): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded()
      const book = this.books.get(id)
      if (!book) throw new Error(`书籍不存在：${id}`)
      this.books.set(id, { ...book, lastOpenedAt: openedAt })
      await this.flush()
    })
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    const text = await this.store.read()
    if (text !== null && text.trim() !== '') {
      const parsed = parseLibrary(text, this.now())
      this.books = new Map(parsed.books.map((book) => [book.id, book]))
      this.locators = parsed.locators
    }

    this.loaded = true
  }

  private async flush(): Promise<void> {
    await this.store.write(serializeLibrary(this.books.values(), this.locators))
  }

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.lock.then(task, task)
    this.lock = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
