import { compareBooksForShelf, reviveBook, type Book } from '../domain/book'
import { isRecord } from '../domain/guards'
import { reviveLocator, type ReadingLocator } from '../domain/progress'

export const LIBRARY_FORMAT_VERSION = 1

export interface LibrarySnapshot {
  version: number
  books: Book[]
  locators: Record<string, ReadingLocator>
}

/** 存档无法解析时抛出，调用方据此备份原文件并以空书库启动。 */
export class LibraryCorruptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibraryCorruptError'
  }
}

export function serializeLibrary(books: Iterable<Book>, locators: Map<string, ReadingLocator>): string {
  const ordered = [...books].sort(compareBooksForShelf)
  const locatorRecord: Record<string, ReadingLocator> = {}
  for (const book of ordered) {
    const locator = locators.get(book.id)
    if (locator) locatorRecord[book.id] = locator
  }

  const snapshot: LibrarySnapshot = {
    version: LIBRARY_FORMAT_VERSION,
    books: ordered,
    locators: locatorRecord
  }

  return `${JSON.stringify(snapshot, null, 2)}\n`
}

export interface ParsedLibrary {
  books: Book[]
  locators: Map<string, ReadingLocator>
  /**
   * 被丢弃的条目数量，用于诊断而不是静默吞掉。
   *
   * 三种原因**合并计数**，不区分来源，与 ParsedAnnotations 的 dropped 同义：
   * ① 字段非法导致 reviveBook 返回 null；
   * ② 进度没有对应书籍（孤儿进度，刻意清理）；
   * ③ 字段非法导致 reviveLocator 返回 null。
   *
   * ② 不是数据损坏，而是防止孤儿进度无限增长的有意回收，所以这个数偏大并不等于
   * 存档有问题。目前没有生产调用方读它（JsonBookRepository.ensureLoaded 直接丢弃），
   * 界面真要区分「数据坏了」和「正常回收」，得先把这个数拆成明细。
   */
  dropped: number
}

/**
 * 宽容解析：单条记录损坏只丢弃该条并计数，不影响整库读取。
 * 只有整个文件不是合法 JSON / 根节点不是对象时才判定为损坏。
 */
export function parseLibrary(text: string, now: number = Date.now()): ParsedLibrary {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new LibraryCorruptError('书库文件不是合法的 JSON')
  }

  if (!isRecord(raw)) throw new LibraryCorruptError('书库文件根节点不是对象')

  const books: Book[] = []
  const locators = new Map<string, ReadingLocator>()
  let dropped = 0

  const rawBooks = Array.isArray(raw.books) ? raw.books : []
  for (const entry of rawBooks) {
    const book = reviveBook(entry, now)
    if (!book) {
      dropped += 1
      continue
    }
    books.push(book)
  }

  const seen = new Set(books.map((book) => book.id))
  const rawLocators = isRecord(raw.locators) ? raw.locators : {}
  for (const [bookId, entry] of Object.entries(rawLocators)) {
    // 没有对应书籍的进度是垃圾数据，直接丢弃，避免无限增长
    if (!seen.has(bookId)) {
      dropped += 1
      continue
    }
    const locator = reviveLocator(entry, now)
    if (!locator) {
      dropped += 1
      continue
    }
    locators.set(bookId, locator)
  }

  return { books, locators, dropped }
}

export function isCorruptLibraryError(error: unknown): error is LibraryCorruptError {
  return error instanceof LibraryCorruptError
}
