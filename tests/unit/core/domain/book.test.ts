import { describe, expect, it } from 'vitest'
import {
  compareBooksForShelf,
  createBook,
  detectBookFormat,
  normalizeBookAuthor,
  normalizeBookTitle,
  UNTITLED_BOOK_TITLE,
  type Book
} from '@core/domain/book'

function shelfBook(overrides: Partial<Book> & { id: string }): Book {
  return {
    ...createBook({ id: overrides.id, format: 'epub', filePath: `C:/lib/${overrides.id}.epub`, fileSize: 10 }),
    ...overrides
  }
}

describe('detectBookFormat', () => {
  it('识别 epub 与 txt，忽略大小写', () => {
    expect(detectBookFormat('C:/books/三体.EPUB')).toBe('epub')
    expect(detectBookFormat('C:/books/note.txt')).toBe('txt')
    expect(detectBookFormat('/home/me/a.TxT')).toBe('txt')
  })

  it('对无扩展名或未知扩展名返回 null', () => {
    expect(detectBookFormat('C:/books/README')).toBeNull()
    expect(detectBookFormat('C:/books/book.pdf')).toBeNull()
    expect(detectBookFormat('C:/books/.hidden')).toBeNull()
    expect(detectBookFormat('')).toBeNull()
  })

  it('路径中的点号不会干扰扩展名识别', () => {
    expect(detectBookFormat('C:/my.books/三体.epub')).toBe('epub')
    expect(detectBookFormat('C:/my.docs/readme')).toBeNull()
  })
})

describe('normalizeBookTitle', () => {
  it('去掉控制字符并合并空白', () => {
    expect(normalizeBookTitle('  三体\u0000\n第一部  ')).toBe('三体 第一部')
  })

  it('空值与空白回落到占位标题', () => {
    expect(normalizeBookTitle(null)).toBe(UNTITLED_BOOK_TITLE)
    expect(normalizeBookTitle(undefined)).toBe(UNTITLED_BOOK_TITLE)
    expect(normalizeBookTitle('   ')).toBe(UNTITLED_BOOK_TITLE)
  })

  it('超长标题被截断，避免撑坏书架布局', () => {
    expect(normalizeBookTitle('长'.repeat(500))).toHaveLength(200)
  })
})

describe('normalizeBookAuthor', () => {
  it('空值返回 null 而不是空字符串', () => {
    expect(normalizeBookAuthor('')).toBeNull()
    expect(normalizeBookAuthor('  \t ')).toBeNull()
    expect(normalizeBookAuthor(undefined)).toBeNull()
  })

  it('清理后保留作者名', () => {
    expect(normalizeBookAuthor('  刘慈欣 ')).toBe('刘慈欣')
  })
})

describe('createBook', () => {
  it('规范化字段并记录导入时间', () => {
    const book = createBook(
      { id: ' b1 ', title: ' 三体 ', author: ' ', format: 'epub', filePath: ' C:/lib/a.epub ', fileSize: 2048.4 },
      12345
    )

    expect(book).toEqual({
      id: 'b1',
      title: '三体',
      author: null,
      format: 'epub',
      filePath: 'C:/lib/a.epub',
      fileSize: 2048,
      coverPath: null,
      addedAt: 12345,
      lastOpenedAt: null
    })
  })

  it('拒绝空 id 与空路径，避免产生无法定位的书籍', () => {
    expect(() => createBook({ id: '  ', format: 'epub', filePath: 'a.epub', fileSize: 1 })).toThrow(/id/)
    expect(() => createBook({ id: 'a', format: 'epub', filePath: '  ', fileSize: 1 })).toThrow(/路径/)
  })

  it('非法文件大小被收敛为 0', () => {
    expect(createBook({ id: 'a', format: 'txt', filePath: 'a.txt', fileSize: Number.NaN }).fileSize).toBe(0)
    expect(createBook({ id: 'a', format: 'txt', filePath: 'a.txt', fileSize: -5 }).fileSize).toBe(0)
  })
})

describe('compareBooksForShelf', () => {
  it('最近阅读的书排最前', () => {
    const a = shelfBook({ id: 'a', lastOpenedAt: 100 })
    const b = shelfBook({ id: 'b', lastOpenedAt: 200 })
    expect([a, b].sort(compareBooksForShelf).map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('都没读过时按导入时间倒序', () => {
    const a = shelfBook({ id: 'a', addedAt: 100 })
    const b = shelfBook({ id: 'b', addedAt: 300 })
    const c = shelfBook({ id: 'c', addedAt: 200 })
    expect([a, b, c].sort(compareBooksForShelf).map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('读过的书始终排在没读过的书前面', () => {
    const read = shelfBook({ id: 'read', addedAt: 1, lastOpenedAt: 1 })
    const fresh = shelfBook({ id: 'fresh', addedAt: 999 })
    expect([fresh, read].sort(compareBooksForShelf).map((item) => item.id)).toEqual(['read', 'fresh'])
  })

  it('时间完全相同时用 id 兜底，保证顺序稳定', () => {
    const a = shelfBook({ id: 'a', addedAt: 5, lastOpenedAt: 5 })
    const b = shelfBook({ id: 'b', addedAt: 5, lastOpenedAt: 5 })
    expect([b, a].sort(compareBooksForShelf).map((item) => item.id)).toEqual(['a', 'b'])
  })
})
