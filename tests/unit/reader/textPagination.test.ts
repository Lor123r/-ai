import { describe, expect, it } from 'vitest'
import {
  COLUMN_GAP_FACTOR,
  clampPage,
  columnGap,
  columnStep,
  offsetForPage,
  totalPagesFromScroll
} from '@renderer/reader/textPagination'

describe('columnStep 与 columnGap', () => {
  it('步进 = 栏宽 + 栏间距', () => {
    expect(COLUMN_GAP_FACTOR).toBe(2)
    expect(columnStep(800, 32)).toBe(800 + 64)
  })

  it('栏间距取页边距的两倍', () => {
    expect(columnGap(32)).toBe(64)
    expect(columnGap(0)).toBe(0)
  })

  it('步进与栏间距用的是同一个换算，否则总栏数会算多', () => {
    for (const margin of [0, 12, 32, 40]) {
      expect(columnStep(700, margin) - 700).toBe(columnGap(margin))
    }
  })

  it('栏宽还没量出来（0 或非数）时步进取 1，不做除零', () => {
    expect(columnStep(0, 32)).toBe(64)
    expect(columnStep(Number.NaN, 32)).toBe(64)
    expect(columnStep(-100, 0)).toBe(1)
  })

  it('页边距非法时按 0 算', () => {
    expect(columnStep(500, Number.NaN)).toBe(500)
    expect(columnGap(Number.NaN)).toBe(0)
    expect(columnStep(500, -20)).toBe(500)
  })
})

describe('totalPagesFromScroll', () => {
  it('内容宽不足一栏时也算 1 栏', () => {
    expect(totalPagesFromScroll(300, 800, 64)).toBe(1)
    expect(totalPagesFromScroll(0, 800, 64)).toBe(1)
  })

  it('内容正好占满两栏时不报 3 栏', () => {
    // 两栏内容 = 2 * 800 + 1 个栏间距，最后一栏右边不留 gap
    const content = 2 * 800 + 64

    expect(totalPagesFromScroll(content, 864, 64)).toBe(2)
  })

  it('内容正好占满三栏时报 3 栏', () => {
    const content = 3 * 800 + 2 * 64

    expect(totalPagesFromScroll(content, 864, 64)).toBe(3)
  })

  it('差一像素到两栏不算少一栏', () => {
    expect(totalPagesFromScroll(2 * 800 + 64 - 1, 864, 64)).toBe(2)
  })

  it('首帧量不到宽度时返回 1 栏而不是 NaN', () => {
    expect(totalPagesFromScroll(Number.NaN, Number.NaN, Number.NaN)).toBe(1)
    expect(totalPagesFromScroll(-5, 0, -5)).toBe(1)
  })
})

describe('offsetForPage', () => {
  it('第 1 页不平移', () => {
    expect(offsetForPage(1, 864, 3)).toBe(0)
  })

  it('第 n 页按步进往左移', () => {
    expect(offsetForPage(2, 864, 3)).toBe(-864)
    expect(offsetForPage(3, 864, 3)).toBe(-1728)
  })

  it('页码越界时夹回有效范围', () => {
    expect(offsetForPage(99, 864, 3)).toBe(-1728)
    expect(offsetForPage(0, 864, 3)).toBe(0)
    expect(offsetForPage(-4, 864, 3)).toBe(0)
  })

  it('总页数非法时按 1 页算，偏移恒为 0', () => {
    expect(offsetForPage(3, 864, Number.NaN)).toBe(0)
    expect(offsetForPage(3, 864, 0)).toBe(0)
  })

  it('步进非法时不产生 -0 或 NaN', () => {
    expect(offsetForPage(2, 0, 3)).toBe(-1)
    expect(offsetForPage(2, Number.NaN, 3)).toBe(-1)
  })
})

describe('clampPage', () => {
  it('落在范围内的页码原样返回', () => {
    expect(clampPage(2, 5)).toBe(2)
  })

  it('超过总页数时夹到最后一页', () => {
    expect(clampPage(9, 5)).toBe(5)
  })

  it('小于 1 时夹到第一页', () => {
    expect(clampPage(0, 5)).toBe(1)
  })

  it('总页数非法时至少留 1 页', () => {
    expect(clampPage(3, Number.NaN)).toBe(1)
    expect(clampPage(3, 0)).toBe(1)
  })

  it('非整数页码先四舍五入再夹取', () => {
    expect(clampPage(2.6, 5)).toBe(3)
    expect(clampPage(Number.NaN, 5)).toBe(1)
  })
})
