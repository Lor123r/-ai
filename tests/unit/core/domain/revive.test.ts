import { describe, expect, it } from 'vitest'
import { reviveBook } from '@core/domain/book'
import { isFiniteNumber, isNonEmptyString, isRecord } from '@core/domain/guards'
import { reviveLocator } from '@core/domain/progress'

const NOW = 1_700_000_000_000

describe('guards', () => {
  it('isRecord 只认普通对象', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(isRecord('文本')).toBe(false)
    expect(isRecord(7)).toBe(false)
  })

  it('isNonEmptyString 拒绝空白字符串', () => {
    expect(isNonEmptyString(' id ')).toBe(true)
    expect(isNonEmptyString('   ')).toBe(false)
    expect(isNonEmptyString('')).toBe(false)
    expect(isNonEmptyString(undefined)).toBe(false)
  })

  it('isFiniteNumber 拒绝 NaN 与 Infinity', () => {
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(-1.5)).toBe(true)
    expect(isFiniteNumber(Number.NaN)).toBe(false)
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isFiniteNumber('1')).toBe(false)
  })
})

describe('reviveBook', () => {
  it('非对象或关键字段缺失时返回 null，让调用方丢弃该条', () => {
    expect(reviveBook(null, NOW)).toBeNull()
    expect(reviveBook('书本', NOW)).toBeNull()
    expect(reviveBook({}, NOW)).toBeNull()
    expect(reviveBook({ id: 'a', format: 'epub' }, NOW)).toBeNull()
    expect(reviveBook({ id: 'a', filePath: 'C:/a.epub' }, NOW)).toBeNull()
    expect(reviveBook({ id: 'a', filePath: 'C:/a.epub', format: 'pdf' }, NOW)).toBeNull()
  })

  it('还原合法记录并补齐缺失的可选字段', () => {
    const revived = reviveBook({ id: ' a ', filePath: ' C:/a.epub ', format: 'epub' }, NOW)

    expect(revived).toEqual({
      id: 'a',
      title: '未命名书籍',
      author: null,
      format: 'epub',
      filePath: 'C:/a.epub',
      fileSize: 0,
      coverPath: null,
      addedAt: NOW,
      lastOpenedAt: null
    })
  })

  it('清理标题与作者里的控制字符和多空格', () => {
    const revived = reviveBook(
      {
        id: 'a',
        filePath: 'C:/a.epub',
        format: 'txt',
        title: '  夜里\t的  图书馆  ',
        author: '   '
      },
      NOW
    )

    expect(revived).toMatchObject({ title: '夜里 的 图书馆', author: null })
  })

  it('非法的时间戳、文件大小和封面被归一化而不是整条丢弃', () => {
    const revived = reviveBook(
      {
        id: 'a',
        filePath: 'C:/a.epub',
        format: 'epub',
        fileSize: -5,
        addedAt: 'yesterday',
        lastOpenedAt: Number.NaN,
        coverPath: '  '
      },
      NOW
    )

    expect(revived).toMatchObject({ fileSize: 0, addedAt: NOW, lastOpenedAt: null, coverPath: null })
  })

  it('保留合法的最近阅读时间', () => {
    const revived = reviveBook(
      { id: 'a', filePath: 'C:/a.epub', format: 'epub', addedAt: 1, lastOpenedAt: 2.6 },
      NOW
    )

    expect(revived).toMatchObject({ addedAt: 1, lastOpenedAt: 3 })
  })
})

describe('reviveLocator', () => {
  it('非对象一律丢弃', () => {
    expect(reviveLocator(null, NOW)).toBeNull()
    expect(reviveLocator([], NOW)).toBeNull()
    expect(reviveLocator('epubcfi(/6/4)', NOW)).toBeNull()
  })

  it('还原合法记录', () => {
    const revived = reviveLocator({ cfi: ' epubcfi(/6/4) ', percent: 0.42, chapterIndex: 3, updatedAt: 5 }, NOW)

    expect(revived).toEqual({ cfi: 'epubcfi(/6/4)', percent: 0.42, chapterIndex: 3, updatedAt: 5 })
  })

  it('越界进度被夹紧、非法章节号与时间戳被兜底', () => {
    expect(reviveLocator({ percent: 3, chapterIndex: -1, updatedAt: 'now' }, NOW)).toEqual({
      cfi: null,
      percent: 1,
      chapterIndex: null,
      updatedAt: NOW
    })
    expect(reviveLocator({ percent: Number.NaN }, NOW)).toMatchObject({ percent: 0 })
  })
})
