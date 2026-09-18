import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  createBookmark,
  createHighlight,
  type BookmarkAnnotation,
  type HighlightAnnotation,
  type HighlightColor
} from '@core/domain/annotation'
import {
  BOOKMARK_MARK_DATA,
  BOOKMARK_MARK_TYPE,
  createBookmarkMarkSyncer,
  createHighlightSyncer,
  highlightStyles
} from '@renderer/reader/annotationHighlight'
import { highlightFill } from '@renderer/reader/highlightPalette'
import type { EpubAnnotationLayer } from '@renderer/reader/createEpubBook'

interface RecordedCall {
  kind: 'add' | 'remove'
  type: string
  cfiRange: string
  /** 第 3 个参数：书签靠它带 `{ bookmark: 'true' }`，划线则一律不传（配色走 styles）。 */
  data?: object
  className?: string
  styles?: object
}

interface FakeLayer {
  layer: EpubAnnotationLayer
  calls: RecordedCall[]
  /** 让指定 cfi 的 add 像真实 epub.js 那样抛错（非法 CFI 会死在 `new EpubCFI` 上）。 */
  failOn: (cfiRange: string) => void
  /** 撤掉故障注入，模拟数据被修好。 */
  recover: (cfiRange: string) => void
}

/**
 * 只记账的假图层：断言「画了什么、擦了什么、按什么顺序」就够，不需要真的 SVG。
 *
 * 抛错的模拟方式照着 epub.js 来：`Annotations.add` 第一句就是 `new EpubCFI(cfiRange)`，
 * 抛在插 DOM 之前，所以失败的那次调用不进 `calls` —— 与「画不上就不该被当成画过」一致。
 */
function fakeLayer(): FakeLayer {
  const calls: RecordedCall[] = []
  const broken = new Set<string>()

  return {
    calls,
    failOn: (cfiRange) => {
      broken.add(cfiRange)
    },
    recover: (cfiRange) => {
      broken.delete(cfiRange)
    },
    layer: {
      add(type, cfiRange, data, _callback, className, styles) {
        if (broken.has(cfiRange)) throw new TypeError(`Invalid CFI: ${cfiRange}`)
        calls.push({ kind: 'add', type, cfiRange, data, className, styles })
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

  // 图层的 add 会在 new EpubCFI 上抛（存档里的 cfi 可能来自手改或后续的导入功能），
  // 往外抛会把 React 的同步 effect 整条打挂 —— 必须吞掉，并且不许记成已经画过
  it('图层抛错时不向外抛，也不把这一条记成已画（下一轮同步会补画）', () => {
    const { layer, calls, failOn, recover } = fakeLayer()
    const syncer = createHighlightSyncer(layer)
    failOn('epubcfi(/6/2)')

    expect(() => syncer.sync([highlight('a', 'epubcfi(/6/2)')])).not.toThrow()
    expect(calls).toHaveLength(0)

    recover('epubcfi(/6/2)')
    syncer.sync([highlight('a', 'epubcfi(/6/2)')])

    expect(calls).toEqual([
      {
        kind: 'add',
        type: 'highlight',
        cfiRange: 'epubcfi(/6/2)',
        data: undefined,
        className: undefined,
        styles: highlightStyles(DEFAULT_HIGHLIGHT_COLOR)
      }
    ])
  })

  it('改色画失败时不算数，修好之后下一轮同步会把新配色补上', () => {
    const { layer, calls, failOn, recover } = fakeLayer()
    const syncer = createHighlightSyncer(layer)
    syncer.sync([highlight('a', 'epubcfi(/6/2)', 'yellow')])
    calls.length = 0

    failOn('epubcfi(/6/2)')
    expect(() => syncer.sync([highlight('a', 'epubcfi(/6/2)', 'blue')])).not.toThrow()

    recover('epubcfi(/6/2)')
    syncer.sync([highlight('a', 'epubcfi(/6/2)', 'blue')])

    // 擦旧标记照常发生，但新配色没画上就不算改过色，否则这条划线会永远停在旧色上
    expect(calls[calls.length - 1]).toMatchObject({
      kind: 'add',
      cfiRange: 'epubcfi(/6/2)',
      styles: highlightStyles('blue')
    })
  })
})

describe('createBookmarkMarkSyncer', () => {
  const CFI = 'epubcfi(/6/12!/4/2)'
  const OTHER_CFI = 'epubcfi(/6/14!/4/2)'

  function bookmark(id: string, cfi: string) {
    return createBookmark({ id, bookId: 'book-1', cfi, chapterHref: 'ch1.xhtml', percent: 0.55 })
  }

  /** 一次 add 的完整期望：书签没有类名、没有配色，只有 type / cfi / data 三样。 */
  function painted(cfiRange: string): RecordedCall {
    return {
      kind: 'add',
      type: BOOKMARK_MARK_TYPE,
      cfiRange,
      data: BOOKMARK_MARK_DATA,
      className: undefined,
      styles: undefined
    }
  }

  function erased(cfiRange: string): RecordedCall {
    return { kind: 'remove', type: BOOKMARK_MARK_TYPE, cfiRange }
  }

  // 样式表与 E2E 都锚在这两个取值上，改一个字符就会让标记看不见
  it('type 与 data 就是样式表和 E2E 锚定的那两个取值，且 data 是冻结的', () => {
    expect(BOOKMARK_MARK_TYPE).toBe('mark')
    expect(BOOKMARK_MARK_DATA).toEqual({ bookmark: 'true' })
    expect(Object.isFrozen(BOOKMARK_MARK_DATA)).toBe(true)
  })

  it('首次同步给每条书签各画一枚 mark，data 里带 bookmark=true', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)

    syncer.sync([bookmark('a', CFI), bookmark('b', OTHER_CFI)])

    expect(calls).toEqual([painted(CFI), painted(OTHER_CFI)])
  })

  it('列表没变时一条都不重画，避免给同一个 cfi 叠出清不掉的孤儿标记', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)
    const list = [bookmark('a', CFI), bookmark('b', OTHER_CFI)]

    syncer.sync(list)
    calls.length = 0
    syncer.sync(list)
    syncer.sync([...list])

    expect(calls).toHaveLength(0)
  })

  it('新增一条只画新增的那条，已有的一条都不动', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)

    syncer.sync([bookmark('a', CFI)])
    syncer.sync([bookmark('a', CFI), bookmark('b', OTHER_CFI)])

    expect(calls).toEqual([painted(CFI), painted(OTHER_CFI)])
  })

  it('删掉一条只摘那一条', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)

    syncer.sync([bookmark('a', CFI), bookmark('b', OTHER_CFI)])
    calls.length = 0
    syncer.sync([bookmark('b', OTHER_CFI)])

    expect(calls).toEqual([erased(CFI)])
  })

  // epub.js 的 marks 表按 cfi 索引、mark() 又幂等：同一个 cfi 上的两条书签塌成一枚 DOM 标记
  it('同一 cfi 上两条书签只画一枚标记', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)

    syncer.sync([bookmark('a', CFI), bookmark('b', CFI)])

    expect(calls).toEqual([painted(CFI)])
  })

  it('同一 cfi 上删掉其中一条时一条都不摘，免得幸存那条的标记再也补不回来', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)

    syncer.sync([bookmark('a', CFI), bookmark('b', CFI)])
    calls.length = 0
    syncer.sync([bookmark('b', CFI)])

    expect(calls).toHaveLength(0)
  })

  it('同一 cfi 上两条都删掉时才摘一次', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)

    syncer.sync([bookmark('a', CFI), bookmark('b', CFI)])
    calls.length = 0
    syncer.sync([])

    expect(calls).toEqual([erased(CFI)])
  })

  it('reset 摘掉自己画过的每条并销账，之后的同步会重新画一遍', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)
    const list = [bookmark('a', CFI), bookmark('b', OTHER_CFI)]

    syncer.sync(list)
    calls.length = 0
    syncer.reset()

    expect(calls).toEqual([erased(CFI), erased(OTHER_CFI)])

    calls.length = 0
    syncer.sync(list)

    expect(calls).toEqual([painted(CFI), painted(OTHER_CFI)])
  })

  it('空表下 reset 不做任何事', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)

    syncer.reset()

    expect(calls).toHaveLength(0)
  })

  it('非法 cfi 让图层抛错时不向外抛、不记账，下一轮同步自己会补画', () => {
    const { layer, calls, failOn, recover } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)
    const broken = '这是一条手改坏掉的定位'
    failOn(broken)

    expect(() => syncer.sync([bookmark('a', broken)])).not.toThrow()
    expect(calls).toHaveLength(0)

    // 没画上的那条一旦进了记账表，之后数据修好也永远不会重画
    recover(broken)
    syncer.sync([bookmark('a', broken)])

    expect(calls).toEqual([painted(broken)])
  })

  it('同一批里一条抛错不影响其它条，合法的照常画出', () => {
    const { layer, calls, failOn } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)
    failOn(OTHER_CFI)

    expect(() => syncer.sync([bookmark('a', CFI), bookmark('b', OTHER_CFI)])).not.toThrow()

    expect(calls).toEqual([painted(CFI)])
  })

  it('接受只读列表（上游直接传 state 派生结果）', () => {
    const { layer, calls } = fakeLayer()
    const syncer = createBookmarkMarkSyncer(layer)
    const list: readonly BookmarkAnnotation[] = [bookmark('a', CFI)]

    syncer.sync(list)

    expect(calls).toEqual([painted(CFI)])
  })

  // HIGHLIGHT_TYPE 是模块私有常量，只能从图层收到的调用上把它的实际取值读回来
  it('与划线各自用各自的 type，否则书签的 remove 会把同一条 cfi 上的划线一起摘掉', () => {
    const { layer, calls } = fakeLayer()

    createHighlightSyncer(layer).sync([highlight('a', CFI)])
    createBookmarkMarkSyncer(layer).sync([bookmark('b', CFI)])

    expect(calls[0].type).toBe('highlight')
    expect(BOOKMARK_MARK_TYPE).not.toBe(calls[0].type)
    expect(calls[1].type).toBe(BOOKMARK_MARK_TYPE)
  })
})
