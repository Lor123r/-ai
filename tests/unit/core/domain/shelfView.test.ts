import { describe, expect, it } from 'vitest'
import { createBook, type Book } from '@core/domain/book'
import { createLocator } from '@core/domain/progress'
import {
  applyShelfView,
  compareShelfEntries,
  DEFAULT_SHELF_VIEW,
  matchesShelfFilter,
  normalizeShelfView,
  type ShelfEntry
} from '@core/domain/shelfView'

function entry(
  id: string,
  overrides: {
    title?: string
    author?: string | null
    format?: 'epub' | 'txt'
    addedAt?: number
    lastOpenedAt?: number | null
    percent?: number | null
  } = {}
): ShelfEntry {
  const book: Book = {
    ...createBook({
      id,
      title: overrides.title ?? `书 ${id}`,
      author: overrides.author === undefined ? '作者甲' : overrides.author,
      format: overrides.format ?? 'epub',
      filePath: `C:/lib/${id}.epub`,
      fileSize: 10
    }),
    addedAt: overrides.addedAt ?? 0,
    lastOpenedAt: overrides.lastOpenedAt ?? null
  }

  return {
    book,
    locator: overrides.percent === undefined || overrides.percent === null
      ? null
      : createLocator({ percent: overrides.percent })
  }
}

function ids(entries: ShelfEntry[]): string[] {
  return entries.map((item) => item.book.id)
}

describe('normalizeShelfView', () => {
  it('非对象一律回落默认值', () => {
    expect(normalizeShelfView(null)).toEqual(DEFAULT_SHELF_VIEW)
    expect(normalizeShelfView('recent')).toEqual(DEFAULT_SHELF_VIEW)
    expect(normalizeShelfView([])).toEqual(DEFAULT_SHELF_VIEW)
    expect(normalizeShelfView(undefined)).toEqual(DEFAULT_SHELF_VIEW)
  })

  it('认不出的字符串逐字段回落，认得出的保留', () => {
    expect(normalizeShelfView({ sort: 'title', filter: '不存在' })).toEqual({
      sort: 'title',
      filter: 'all'
    })
    expect(normalizeShelfView({ sort: '不存在', filter: 'txt' })).toEqual({
      sort: 'recent',
      filter: 'txt'
    })
  })

  it('只给一半字段时另一半回落', () => {
    expect(normalizeShelfView({ sort: 'progress' })).toEqual({ sort: 'progress', filter: 'all' })
    expect(normalizeShelfView({ filter: 'finished' })).toEqual({ sort: 'recent', filter: 'finished' })
  })
})

describe('compareShelfEntries', () => {
  it('recent：最近打开的在最前，没打开过的排后面', () => {
    const entries = [entry('a', { lastOpenedAt: 100 }), entry('b', { lastOpenedAt: 300 }), entry('c')]
    expect(ids(entries.slice().sort((x, y) => compareShelfEntries(x, y, 'recent')))).toEqual(['b', 'a', 'c'])
  })

  it('added：新导入的在最前', () => {
    const entries = [entry('a', { addedAt: 100 }), entry('b', { addedAt: 300 }), entry('c', { addedAt: 200 })]
    expect(ids(entries.slice().sort((x, y) => compareShelfEntries(x, y, 'added')))).toEqual(['b', 'c', 'a'])
  })

  it('title：按书名升序', () => {
    const entries = [entry('a', { title: 'C 书' }), entry('b', { title: 'A 书' }), entry('c', { title: 'B 书' })]
    expect(ids(entries.slice().sort((x, y) => compareShelfEntries(x, y, 'title')))).toEqual(['b', 'c', 'a'])
  })

  it('title：中文按拼音序而不是 UTF-16 码元序', () => {
    // 「三体」的码元 0x4E09 小于「活着」的 0x6D3B，按 < 排会得到反的
    const entries = [entry('a', { title: '三体' }), entry('b', { title: '活着' })]
    expect(ids(entries.slice().sort((x, y) => compareShelfEntries(x, y, 'title')))).toEqual(['b', 'a'])
  })

  it('author：按作者升序，无作者排最后', () => {
    const entries = [
      entry('a', { author: null }),
      entry('b', { author: 'B 作者' }),
      entry('c', { author: 'A 作者' })
    ]
    expect(ids(entries.slice().sort((x, y) => compareShelfEntries(x, y, 'author')))).toEqual(['c', 'b', 'a'])
  })

  it('author：两本都无作者时按 id 兜底', () => {
    const entries = [entry('b', { author: null }), entry('a', { author: null })]
    expect(ids(entries.slice().sort((x, y) => compareShelfEntries(x, y, 'author')))).toEqual(['a', 'b'])
  })

  it('progress：读得多的在最前，没读过的排最后', () => {
    const entries = [entry('a', { percent: 0.2 }), entry('b', { percent: 0.8 }), entry('c')]
    expect(ids(entries.slice().sort((x, y) => compareShelfEntries(x, y, 'progress')))).toEqual(['b', 'a', 'c'])
  })

  it('所有排序都以 id 兜底，输入顺序不影响结果', () => {
    const forward = [entry('a', { title: '同名' }), entry('b', { title: '同名' })]
    const backward = [entry('b', { title: '同名' }), entry('a', { title: '同名' })]

    for (const sort of ['recent', 'added', 'title', 'author', 'progress'] as const) {
      expect(ids(forward.slice().sort((x, y) => compareShelfEntries(x, y, sort)))).toEqual(['a', 'b'])
      expect(ids(backward.slice().sort((x, y) => compareShelfEntries(x, y, sort)))).toEqual(['a', 'b'])
    }
  })
})

describe('matchesShelfFilter', () => {
  it('all 放行全部', () => {
    expect(matchesShelfFilter(entry('a'), 'all')).toBe(true)
    expect(matchesShelfFilter(entry('a', { percent: 1 }), 'all')).toBe(true)
  })

  it('reading 只认「开了头没读完」', () => {
    expect(matchesShelfFilter(entry('a', { percent: 0.4 }), 'reading')).toBe(true)
    expect(matchesShelfFilter(entry('a'), 'reading')).toBe(false)
    expect(matchesShelfFilter(entry('a', { percent: 1 }), 'reading')).toBe(false)
  })

  it('unread 只认一次没开过的', () => {
    expect(matchesShelfFilter(entry('a'), 'unread')).toBe(true)
    expect(matchesShelfFilter(entry('a', { percent: 0 }), 'unread')).toBe(false)
  })

  it('finished 认读到结尾的', () => {
    expect(matchesShelfFilter(entry('a', { percent: 1 }), 'finished')).toBe(true)
    expect(matchesShelfFilter(entry('a', { percent: 0.99 }), 'finished')).toBe(false)
    expect(matchesShelfFilter(entry('a'), 'finished')).toBe(false)
  })

  it('epub / txt 按格式分', () => {
    expect(matchesShelfFilter(entry('a', { format: 'epub' }), 'epub')).toBe(true)
    expect(matchesShelfFilter(entry('a', { format: 'txt' }), 'epub')).toBe(false)
    expect(matchesShelfFilter(entry('a', { format: 'txt' }), 'txt')).toBe(true)
    expect(matchesShelfFilter(entry('a', { format: 'epub' }), 'txt')).toBe(false)
  })

  it('reading / unread / finished 三者互斥且穷尽全部', () => {
    const entries = [
      entry('unread'),
      entry('reading', { percent: 0.4 }),
      entry('finished', { percent: 1 })
    ]

    for (const item of entries) {
      const hits = (['reading', 'unread', 'finished'] as const).filter((filter) =>
        matchesShelfFilter(item, filter)
      )
      expect(hits).toHaveLength(1)
    }

    const covered = (['reading', 'unread', 'finished'] as const).flatMap((filter) =>
      entries.filter((item) => matchesShelfFilter(item, filter))
    )
    expect(ids(covered).sort()).toEqual(['finished', 'reading', 'unread'])
  })
})

describe('applyShelfView', () => {
  it('先筛后排', () => {
    const entries = [
      entry('a', { title: 'C 书', percent: 0.1 }),
      entry('b', { title: 'A 书', percent: 0.9 }),
      entry('c', { title: 'B 书' })
    ]

    expect(ids(applyShelfView(entries, { sort: 'title', filter: 'reading' }))).toEqual(['b', 'a'])
    expect(ids(applyShelfView(entries, { sort: 'progress', filter: 'all' }))).toEqual(['b', 'a', 'c'])
  })

  it('不改动入参数组', () => {
    const entries = [entry('b', { title: 'B' }), entry('a', { title: 'A' })]
    const snapshot = ids(entries)

    applyShelfView(entries, { sort: 'title', filter: 'all' })

    expect(ids(entries)).toEqual(snapshot)
  })

  it('筛完为空时返回空数组', () => {
    expect(applyShelfView([entry('a')], { sort: 'recent', filter: 'finished' })).toEqual([])
  })
})
