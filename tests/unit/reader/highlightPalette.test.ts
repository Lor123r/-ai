import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_COLORS } from '@core/domain/annotation'
import { HIGHLIGHT_COLOR_LABELS, highlightFill } from '@renderer/reader/highlightPalette'

/** #rgb 与 #rrggbb 两种写法都算合法十六进制。 */
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

describe('highlightFill', () => {
  it('每种配色都给出合法的十六进制色值', () => {
    for (const color of HIGHLIGHT_COLORS) {
      expect(highlightFill(color)).toMatch(HEX_COLOR)
    }
  })

  it('四种色值互不相同，否则用户看不出自己选了哪一种', () => {
    const fills = HIGHLIGHT_COLORS.map((color) => highlightFill(color))

    expect(new Set(fills).size).toBe(HIGHLIGHT_COLORS.length)
  })

  it('同一配色反复取到同一个值，浮条与正文才对得上', () => {
    for (const color of HIGHLIGHT_COLORS) {
      expect(highlightFill(color)).toBe(highlightFill(color))
    }
  })
})

describe('HIGHLIGHT_COLOR_LABELS', () => {
  // 色块的可访问名与抽屉的类型标签都读这张表，文案本身就是契约的一部分。
  it('中文名与契约一致', () => {
    expect(HIGHLIGHT_COLOR_LABELS).toEqual({
      yellow: '黄色',
      green: '绿色',
      blue: '蓝色',
      pink: '粉色'
    })
  })

  it('覆盖全部配色，一个都不漏', () => {
    for (const color of HIGHLIGHT_COLORS) {
      expect(typeof HIGHLIGHT_COLOR_LABELS[color]).toBe('string')
      expect(HIGHLIGHT_COLOR_LABELS[color].length).toBeGreaterThan(0)
    }
  })

  it('中文名两两不同，抽屉里才分得清黄色划线与蓝色划线', () => {
    const labels = HIGHLIGHT_COLORS.map((color) => HIGHLIGHT_COLOR_LABELS[color])

    expect(new Set(labels).size).toBe(HIGHLIGHT_COLORS.length)
  })

  it('没有多余的键，避免留下取不到配色的孤儿文案', () => {
    expect(Object.keys(HIGHLIGHT_COLOR_LABELS).sort()).toEqual([...HIGHLIGHT_COLORS].sort())
  })
})
