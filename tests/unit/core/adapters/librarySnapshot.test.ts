import { describe, expect, it } from 'vitest'
import {
  LIBRARY_FORMAT_VERSION,
  LibraryCorruptError,
  isCorruptLibraryError,
  parseLibrary,
  serializeLibrary
} from '@core/adapters/librarySnapshot'
import { createBook, type Book } from '@core/domain/book'
import { createLocator, type ReadingLocator } from '@core/domain/progress'

const NOW = 1_700_000_000_000

function book(id: string, addedAt: number, lastOpenedAt: number | null = null): Book {
  return {
    ...createBook({ id, title: `书名 ${id}`, format: 'epub', filePath: `C:/lib/${id}.epub`, fileSize: 512 }),
    addedAt,
    lastOpenedAt
  }
}

function locator(percent: number): ReadingLocator {
  return createLocator({ cfi: 'epubcfi(/6/4!/4/2)', percent }, NOW)
}

describe('serializeLibrary', () => {
  it('按书架顺序落盘，保证同样的书库总是生成同样的文本', () => {
    const bookA = book('a', NOW - 2000)
    const bookB = book('b', NOW - 1000)
    const text = serializeLibrary([bookA, bookB], new Map())

    const parsed = JSON.parse(text) as { version: number; books: Book[] }
    expect(parsed.version).toBe(LIBRARY_FORMAT_VERSION)
    expect(parsed.books.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('只为仍然存在的书籍写入进度，避免垃圾数据无限增长', () => {
    const text = serializeLibrary([book('a', NOW)], new Map([['a', locator(0.5)], ['ghost', locator(0.9)]]))

    const parsed = JSON.parse(text) as { locators: Record<string, ReadingLocator> }
    expect(Object.keys(parsed.locators)).toEqual(['a'])
  })

  it('末尾带换行，方便用文本编辑器直接查看存档', () => {
    expect(serializeLibrary([], new Map()).endsWith('\n')).toBe(true)
  })
})

describe('parseLibrary', () => {
  it('序列化再解析能完整往返', () => {
    const books = [book('a', NOW - 1000), book('b', NOW, NOW + 10)]
    const locators = { a: locator(0.25), b: locator(0.75) }

    const parsed = parseLibrary(serializeLibrary(books, new Map(Object.entries(locators))), NOW)
    expect(Object.fromEntries(parsed.books.map((item) => [item.id, item]))).toEqual(
      Object.fromEntries(books.map((item) => [item.id, item]))
    )
    expect(Object.fromEntries(parsed.locators)).toEqual(locators)
    expect(parsed.dropped).toBe(0)
  })

  it('整份文件不是合法 JSON 时判定为损坏', () => {
    expect(() => parseLibrary('{ 坏掉的', NOW)).toThrow(LibraryCorruptError)
    expect(() => parseLibrary('{ 坏掉的', NOW)).toThrow(/不是合法的 JSON/)
  })

  it('根节点不是对象时判定为损坏', () => {
    expect(() => parseLibrary('[1,2,3]', NOW)).toThrow(LibraryCorruptError)
    expect(() => parseLibrary('null', NOW)).toThrow(LibraryCorruptError)
    expect(() => parseLibrary('"文本"', NOW)).toThrow(LibraryCorruptError)
  })

  it('缺失字段被视为空书库，而不是损坏', () => {
    expect(parseLibrary('{}', NOW)).toEqual({ books: [], locators: new Map(), dropped: 0 })
    expect(parseLibrary('{"books":null,"locators":7}', NOW)).toEqual({
      books: [],
      locators: new Map(),
      dropped: 0
    })
  })

  it('单条书籍损坏只丢弃该条并计数，其余照常读出', () => {
    const text = JSON.stringify({
      version: 1,
      books: [book('ok', NOW), { id: 'no-format', filePath: 'C:/x.epub' }, 'not-an-object'],
      locators: {}
    })

    const parsed = parseLibrary(text, NOW)
    expect(parsed.books.map((item) => item.id)).toEqual(['ok'])
    expect(parsed.dropped).toBe(2)
  })

  it('没有对应书籍的孤儿进度会被丢弃并计数', () => {
    const text = JSON.stringify({
      version: 1,
      books: [book('a', NOW)],
      locators: { a: locator(0.5), ghost: locator(0.9) }
    })

    const parsed = parseLibrary(text, NOW)
    expect(parsed.locators.size).toBe(1)
    expect(parsed.dropped).toBe(1)
  })

  it('进度非法时丢弃该条，书籍本身仍然保留', () => {
    const text = JSON.stringify({ version: 1, books: [book('a', NOW)], locators: { a: 'not-an-object' } })

    const parsed = parseLibrary(text, NOW)
    expect(parsed.books).toHaveLength(1)
    expect(parsed.locators.size).toBe(0)
    expect(parsed.dropped).toBe(1)
  })

  it('缺失时间戳的书籍用注入的当前时间兜底，保证字段完整', () => {
    const text = JSON.stringify({
      version: 1,
      books: [{ id: 'a', format: 'epub', filePath: 'C:/a.epub' }],
      locators: {}
    })

    const parsed = parseLibrary(text, NOW)
    expect(parsed.books[0]).toMatchObject({ id: 'a', addedAt: NOW, lastOpenedAt: null })
  })
})

describe('isCorruptLibraryError', () => {
  it('只认自己的错误类型', () => {
    expect(isCorruptLibraryError(new LibraryCorruptError('坏'))).toBe(true)
    expect(isCorruptLibraryError(new Error('坏'))).toBe(false)
    expect(isCorruptLibraryError(null)).toBe(false)
  })
})
