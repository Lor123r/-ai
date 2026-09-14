import { describe, expect, it } from 'vitest'
import {
  clampPercent,
  createLocator,
  formatPercentLabel,
  isBookFinished,
  isSameLocation,
  normalizeChapterIndex,
  normalizeCfi
} from '@core/domain/progress'

describe('clampPercent', () => {
  it('把任意数值收敛到 0 ~ 1', () => {
    expect(clampPercent(0.42)).toBe(0.42)
    expect(clampPercent(-3)).toBe(0)
    expect(clampPercent(9)).toBe(1)
  })

  it('非数值输入回落为 0', () => {
    expect(clampPercent(Number.NaN)).toBe(0)
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0)
    expect(clampPercent('0.5')).toBe(0)
    expect(clampPercent(undefined)).toBe(0)
  })
})

describe('normalizeCfi / normalizeChapterIndex', () => {
  it('CFI 空串归一为 null', () => {
    expect(normalizeCfi('  epubcfi(/6/4) ')).toBe('epubcfi(/6/4)')
    expect(normalizeCfi('   ')).toBeNull()
    expect(normalizeCfi(42)).toBeNull()
  })

  it('章序号必须是 0 起的整数', () => {
    expect(normalizeChapterIndex(0)).toBe(0)
    expect(normalizeChapterIndex(7)).toBe(7)
    expect(normalizeChapterIndex(-1)).toBeNull()
    expect(normalizeChapterIndex(1.5)).toBeNull()
    expect(normalizeChapterIndex('3')).toBeNull()
  })
})

describe('createLocator', () => {
  it('规范化非法输入并写入时间戳', () => {
    expect(createLocator({ cfi: ' ', percent: 1.7, chapterIndex: -2 }, 999)).toEqual({
      cfi: null,
      percent: 1,
      chapterIndex: null,
      updatedAt: 999
    })
  })

  it('无参数时表示书首', () => {
    expect(createLocator(undefined, 1)).toEqual({ cfi: null, percent: 0, chapterIndex: null, updatedAt: 1 })
  })
})

describe('isSameLocation', () => {
  it('完全相同认为是同一处', () => {
    const a = createLocator({ cfi: 'x', percent: 0.5, chapterIndex: 1 }, 1)
    const b = createLocator({ cfi: 'x', percent: 0.5, chapterIndex: 1 }, 2)
    expect(isSameLocation(a, b)).toBe(true)
  })

  it('任意字段变化都视为位置改变', () => {
    const base = createLocator({ cfi: 'x', percent: 0.5, chapterIndex: 1 }, 1)
    expect(isSameLocation(base, createLocator({ cfi: 'y', percent: 0.5, chapterIndex: 1 }, 1))).toBe(false)
    expect(isSameLocation(base, createLocator({ cfi: 'x', percent: 0.6, chapterIndex: 1 }, 1))).toBe(false)
    expect(isSameLocation(base, createLocator({ cfi: 'x', percent: 0.5, chapterIndex: 2 }, 1))).toBe(false)
  })

  it('null 只在双方都是 null 时相等', () => {
    const locator = createLocator({ percent: 0.1 }, 1)
    expect(isSameLocation(null, null)).toBe(true)
    expect(isSameLocation(null, locator)).toBe(false)
    expect(isSameLocation(locator, null)).toBe(false)
  })
})

describe('formatPercentLabel', () => {
  it('输出整数百分比文本', () => {
    expect(formatPercentLabel(0)).toBe('0%')
    expect(formatPercentLabel(0.426)).toBe('43%')
    expect(formatPercentLabel(1)).toBe('100%')
    expect(formatPercentLabel(2)).toBe('100%')
  })
})

describe('isBookFinished', () => {
  it('接近结尾即视为读完，避免 EPUB 末页进度到不了 100%', () => {
    expect(isBookFinished(0.996)).toBe(true)
    expect(isBookFinished(1)).toBe(true)
    expect(isBookFinished(2)).toBe(true)
    expect(isBookFinished(0.99)).toBe(false)
    expect(isBookFinished(0.5)).toBe(false)
  })

  it('阈值可覆盖，便于以后做成用户可配置', () => {
    expect(isBookFinished(0.8, 0.75)).toBe(true)
    expect(isBookFinished(0.7, 0.75)).toBe(false)
  })
})
