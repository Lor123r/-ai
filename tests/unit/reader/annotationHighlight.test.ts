import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  createHighlight,
  type HighlightAnnotation,
  type HighlightColor
} from '@core/domain/annotation'
import {
  createHighlightSyncer,
  highlightStyles
} from '@renderer/reader/annotationHighlight'
import { highlightFill } from '@renderer/reader/highlightPalette'
import type { EpubAnnotationLayer } from '@renderer/reader/createEpubBook'

interface RecordedCall {
  kind: 'add' | 'remove'
  type: string
  cfiRange: string
  className?: string
  styles?: object
}

/** 只记账的假图层：断言「画了什么、擦了什么、按什么顺序」就够，不需要真的 SVG。 */
function fakeLayer(): { layer: EpubAnnotationLayer; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []

  return {
    calls,
    layer: {
      add(type, cfiRange, _data, _callback, className, styles) {
        calls.push({ kind: 'add', type, cfiRange, className, styles })
      },
      remove(cfiRange, type) {
        calls.push({ kind: 'remove', type, cfiRange })
      }
    }
  }
}

function highlight(id: string, cfi: string, color: HighlightColor = DEFAULT_HIGHLIGHT_COLOR) {
  return createHighlight({ id, bookId: 'book-1', cfi, excerpt: '一段摘录', color })
}

describe('highlightStyles', () => {
  it('每种配色都给出独立的 fill 与不透明度', () => {
    const styles = HIGHLIGHT_COLORS.map((color) => highlightStyles(color))

    for (const style of styles) {
      expect(style['fill-opacity']).toBe('0.35')
      expect(typeof style.fill).toBe('string')
    }
    expect(new Set(styles.map((style) => style.fill)).size).toBe(HIGHLIGHT_COLORS.length)
  })

  it('默认配色落在配色表里', () => {
    expect(HIGHLIGHT_COLORS).toContain(DEFAULT_HIGHLIGHT_COLOR)
  })

  // 色值只准有一份来源：两边各写一份十六进制，改了一处就会浮条与正文不同色。
  it('fill 逐色取自 highlightPalette', () => {
    for (const color of HIGHLIGHT_COLORS) {
      expect(highlightStyles(color).fill).toBe(highlightFill(color))
    }
  })

  it('不透明度仍是 0.35，改配色不该动到可读性', () => {
    for (const color of HIGHLIGHT_COLORS) {
      expect(highlightStyles(color)['fill-opacity']).toBe('0.35')
    }
  })
})

describe('createHighlightSyncer', () => {
  it('首次同步把列表里的划线全部画上，且不传类名（留给 epub.js 默认的 epubjs-hl）', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createHighlightSyncer(layer)

    syncer.sync([highlight('a', 'epubcfi(/6/2)', 'green')])

    expect(calls).toEqual([
      {
        kind: 'add',
        type: 'highlight',
        cfiRange: 'epubcfi(/6/2)',
        className: undefined,
        styles: highlightStyles('green')
      }
    ])
  })

  it('列表没变时什么都不做，避免给同一个 cfi 叠出清不掉的孤儿标记', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createHighlightSyncer(layer)
    const list = [highlight('a', 'epubcfi(/6/2)'), highlight('b', 'epubcfi(/6/4)')]

    syncer.sync(list)
    syncer.sync(list)
    syncer.sync([...list])

    expect(calls).toHaveLength(2)
  })

  it('新增一条只画新增的那条，已有的一条都不动', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createHighlightSyncer(layer)

    syncer.sync([highlight('a', 'epubcfi(/6/2)')])
    syncer.sync([highlight('a', 'epubcfi(/6/2)'), highlight('b', 'epubcfi(/6/4)')])

    expect(calls.filter((call) => call.kind === 'add').map((call) => call.cfiRange)).toEqual([
      'epubcfi(/6/2)',
      'epubcfi(/6/4)'
    ])
    expect(calls.filter((call) => call.kind === 'remove')).toHaveLength(0)
  })

  it('删除一条只擦那一条', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createHighlightSyncer(layer)

    syncer.sync([highlight('a', 'epubcfi(/6/2)'), highlight('b', 'epubcfi(/6/4)')])
    calls.length = 0
    syncer.sync([highlight('b', 'epubcfi(/6/4)')])

    expect(calls).toEqual([{ kind: 'remove', type: 'highlight', cfiRange: 'epubcfi(/6/2)' }])
  })

  it('配色变了要先擦再画，不能只 add（epub.js 的 marks 表按 cfi 记账会让旧标记失去引用）', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createHighlightSyncer(layer)

    syncer.sync([highlight('a', 'epubcfi(/6/2)', 'yellow')])
    calls.length = 0
    syncer.sync([highlight('a', 'epubcfi(/6/2)', 'blue')])

    expect(calls.map((call) => call.kind)).toEqual(['remove', 'add'])
    expect(calls[1].styles).toEqual(highlightStyles('blue'))
  })

  it('位置变了同样先擦旧再画新', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createHighlightSyncer(layer)

    syncer.sync([highlight('a', 'epubcfi(/6/2)')])
    calls.length = 0
    syncer.sync([highlight('a', 'epubcfi(/6/8)')])

    expect(calls).toEqual([
      { kind: 'remove', type: 'highlight', cfiRange: 'epubcfi(/6/2)' },
      {
        kind: 'add',
        type: 'highlight',
        cfiRange: 'epubcfi(/6/8)',
        className: undefined,
        styles: highlightStyles('yellow')
      }
    ])
  })

  it('reset 擦掉自己画过的全部标记并销账，之后的同步会重新画一遍', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createHighlightSyncer(layer)
    const list = [highlight('a', 'epubcfi(/6/2)'), highlight('b', 'epubcfi(/6/4)')]

    syncer.sync(list)
    calls.length = 0
    syncer.reset()

    expect(calls.map((call) => call.cfiRange)).toEqual(['epubcfi(/6/2)', 'epubcfi(/6/4)'])
    expect(calls.every((call) => call.kind === 'remove')).toBe(true)

    calls.length = 0
    syncer.sync(list)

    expect(calls).toHaveLength(2)
    expect(calls.every((call) => call.kind === 'add')).toBe(true)
  })

  it('空列表不会画出任何东西', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createHighlightSyncer(layer)

    syncer.sync([])

    expect(calls).toHaveLength(0)
  })

  it('接受只读列表（上游直接传 state 派生结果）', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createHighlightSyncer(layer)
    const list: readonly HighlightAnnotation[] = [highlight('a', 'epubcfi(/6/2)')]

    syncer.sync(list)

    expect(calls).toHaveLength(1)
  })
})
