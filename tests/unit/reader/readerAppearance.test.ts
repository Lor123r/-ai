import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_READER_SETTINGS, READER_FONT_FAMILIES, READER_THEMES, type ReaderSettings } from '@core/domain/settings'
import {
  READER_FONT_LABELS,
  READER_THEME_COLORS,
  READER_THEME_LABELS,
  applyReaderSettings
} from '@renderer/reader/readerAppearance'

function settings(patch: Partial<ReaderSettings> = {}): ReaderSettings {
  return { ...DEFAULT_READER_SETTINGS, ...patch }
}

function fakeStyler() {
  const calls: Record<string, [string, boolean | undefined]> = {}
  const override = vi.fn((name: string, value: string, priority?: boolean) => {
    calls[name] = [value, priority]
  })
  return { override, calls }
}

describe('applyReaderSettings', () => {
  it('把字号、行高、字体、颜色写进正文样式', () => {
    const styler = fakeStyler()

    applyReaderSettings(styler, settings({ fontSize: 22, lineHeight: 1.9, fontFamily: 'sans', theme: 'sepia' }))

    expect(styler.calls['font-size']).toEqual(['22px', true])
    expect(styler.calls['line-height']).toEqual(['1.9', true])
    expect(styler.calls['font-family']?.[0]).toContain('Microsoft YaHei')
    expect(styler.calls['color']).toEqual([READER_THEME_COLORS.sepia.ink, true])
  })

  it('每一项都带 !important：书内自带的 CSS 优先级往往更高', () => {
    const styler = fakeStyler()

    applyReaderSettings(styler, settings())

    expect(styler.override).toHaveBeenCalledTimes(5)
    for (const call of styler.override.mock.calls) {
      expect(call[2]).toBe(true)
    }
  })

  it('字号换算成 px，行高保持无单位倍数', () => {
    const styler = fakeStyler()

    applyReaderSettings(styler, settings({ fontSize: 15, lineHeight: 1.2 }))

    expect(styler.calls['font-size']?.[0]).toBe('15px')
    expect(styler.calls['line-height']?.[0]).toBe('1.2')
  })

  it('宋体与黑体给出不同的字体栈', () => {
    const serif = fakeStyler()
    const sans = fakeStyler()

    applyReaderSettings(serif, settings({ fontFamily: 'serif' }))
    applyReaderSettings(sans, settings({ fontFamily: 'sans' }))

    expect(serif.calls['font-family']?.[0]).not.toBe(sans.calls['font-family']?.[0])
    expect(serif.calls['font-family']?.[0]).toContain('serif')
    expect(sans.calls['font-family']?.[0]).toContain('sans-serif')
  })

  it('正文底色跟随主题，避免夜间模式下书内默认白底刺眼', () => {
    const styler = fakeStyler()

    applyReaderSettings(styler, settings({ theme: 'night' }))

    expect(styler.calls['background-color']).toEqual([READER_THEME_COLORS.night.paper, true])
  })

  it('不改正文内边距：页边距由外层容器负责，免得和 epub.js 的分栏计算打架', () => {
    const styler = fakeStyler()

    applyReaderSettings(styler, settings({ pageMargin: 80 }))

    expect(styler.calls.padding).toBeUndefined()
    expect(styler.calls['padding-left']).toBeUndefined()
  })

  it('每个主题都有完整配色，不会出现 undefined 落到样式里', () => {
    for (const theme of READER_THEMES) {
      const styler = fakeStyler()
      applyReaderSettings(styler, settings({ theme }))

      for (const call of styler.override.mock.calls) {
        expect(typeof call[1]).toBe('string')
        expect(call[1]).not.toBe('')
        expect(call[1]).not.toContain('undefined')
      }
    }
  })
})

describe('阅读设置文案', () => {
  it('每个主题与字体都有中文名', () => {
    expect(READER_THEMES.map((theme) => READER_THEME_LABELS[theme])).toEqual(['白天', '夜间', '护眼'])
    expect(READER_FONT_FAMILIES.map((font) => READER_FONT_LABELS[font])).toEqual(['宋体', '黑体'])
  })

  it('主题之间纸张与字色都不相同，切换时用户能看出区别', () => {
    const papers = READER_THEMES.map((theme) => READER_THEME_COLORS[theme].paper)
    const inks = READER_THEMES.map((theme) => READER_THEME_COLORS[theme].ink)

    expect(new Set(papers).size).toBe(READER_THEMES.length)
    expect(new Set(inks).size).toBe(READER_THEMES.length)
  })
})
