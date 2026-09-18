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
      await this.commit(
        () => this.books.set(book.id, existing ? { ...book, addedAt: existing.addedAt } : { ...book }),
        () => {
          if (existing) this.books.set(book.id, existing)
          else this.books.delete(book.id)
        }
      )
    })
  }

  async remove(id: string): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded()
      const book = this.books.get(id)
      const locator = this.locators.get(id)
      await this.commit(
        () => {
          this.books.delete(id)
          this.locators.delete(id)
        },
        () => {
          if (book) this.books.set(id, book)
          if (locator) this.locators.set(id, locator)
        }
      )
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
      const existing = this.locators.get(bookId)
      await this.commit(
        () => this.locators.set(bookId, { ...locator }),
        () => {
          if (existing) this.locators.set(bookId, existing)
          else this.locators.delete(bookId)
        }
      )
    })
  }

  async markOpened(id: string, openedAt: number): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded()
      const book = this.books.get(id)
      if (!book) throw new Error(`书籍不存在：${id}`)
      await this.commit(
        () => this.books.set(id, { ...book, lastOpenedAt: openedAt }),
        () => this.books.set(id, book)
      )
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

  /**
   * 先改内存再落盘，落盘失败就把内存改回去。
   *
   * 回滚不是为了让内存「好看」：调用方看到写失败会按「这次操作没发生」来收尾，比如导入
   * 失败时删掉刚复制进来的文件。内存里留着一条没落盘的记录，就会变成书架上有这本书、
   * 正文文件却被清掉的坏状态，比单纯写失败严重得多。回滚用的旧值必须在改动之前取好，
   * 所以调用方要先 await ensureLoaded()。
   */
  private async commit(change: () => void, revert: () => void): Promise<void> {
    change()

    try {
      await this.flush()
    } catch (error) {
      revert()
      throw error
    }
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
