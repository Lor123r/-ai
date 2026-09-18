import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HIGHLIGHT_COLORS, type HighlightColor } from '@core/domain/annotation'
import SelectionToolbar, {
  EDGE,
  GAP,
  TOOLBAR_HEIGHT,
  TOOLBAR_WIDTH,
  placeSelectionToolbar,
  selectionPlacement,
  type RectLike
} from '@renderer/reader/SelectionToolbar'
import { HIGHLIGHT_COLOR_LABELS, highlightFill } from '@renderer/reader/highlightPalette'
import type { EpubContents, EpubSelection } from '@renderer/reader/createEpubBook'

function rect(top: number, left: number, width: number, height: number): RectLike {
  return { top, left, width, height }
}

/** 选区与 iframe 都从 iframe 内部读坐标，那里拿到的就是 DOMRect。 */
function asRect(value: RectLike): DOMRect {
  return value as DOMRect
}

const CONTAINER = rect(0, 0, 400, 600)

describe('placeSelectionToolbar', () => {
  it('选区上方放得下时就贴在选区上方', () => {
    const placement = placeSelectionToolbar({
      selection: rect(300, 100, 80, 20),
      frame: rect(0, 0, 0, 0),
      container: CONTAINER
    })

    expect(placement).toEqual({
      top: 300 - TOOLBAR_HEIGHT - GAP,
      left: 100 + 80 / 2 - TOOLBAR_WIDTH / 2,
      fallback: false
    })
  })

  it('选区贴着上沿时翻到选区下方', () => {
    const placement = placeSelectionToolbar({
      selection: rect(10, 100, 80, 20),
      frame: rect(0, 0, 0, 0),
      container: CONTAINER
    })

    expect(placement.top).toBe(10 + 20 + GAP)
    expect(placement.fallback).toBe(false)
  })

  it('坐标要先补上 iframe 相对容器的偏移', () => {
    const placement = placeSelectionToolbar({
      selection: rect(300, 100, 80, 20),
      frame: rect(50, 30, 0, 0),
      container: rect(20, 10, 400, 600)
    })

    // 选区在容器里其实位于 top 330 / left 120
    expect(placement.top).toBe(330 - TOOLBAR_HEIGHT - GAP)
    expect(placement.left).toBe(120 + 40 - TOOLBAR_WIDTH / 2)
  })

  it('上下都放不下时落回容器顶部并标 fallback', () => {
    const placement = placeSelectionToolbar({
      selection: rect(300, 100, 80, 20),
      frame: rect(0, 0, 0, 0),
      container: rect(0, 0, 400, 40)
    })

    expect(placement).toEqual({ top: EDGE, left: 100 + 40 - TOOLBAR_WIDTH / 2, fallback: true })
  })

  it('翻到下方仍然放不下也算 fallback', () => {
    const placement = placeSelectionToolbar({
      selection: rect(20, 100, 80, 20),
      frame: rect(0, 0, 0, 0),
      container: rect(0, 0, 400, 50)
    })

    expect(placement.fallback).toBe(true)
    expect(placement.top).toBe(EDGE)
  })

  it('左右越界时夹回容器内侧', () => {
    const right = placeSelectionToolbar({
      selection: rect(300, 1000, 0, 20),
      frame: rect(0, 0, 0, 0),
      container: CONTAINER
    })
    expect(right.left).toBe(400 - TOOLBAR_WIDTH - EDGE)

    const left = placeSelectionToolbar({
      selection: rect(300, -500, 0, 20),
      frame: rect(0, 0, 0, 0),
      container: CONTAINER
    })
    expect(left.left).toBe(EDGE)
  })

  it('容器比浮条还窄时夹到左边缘，不出现负数', () => {
    const placement = placeSelectionToolbar({
      selection: rect(300, 40, 0, 20),
      frame: rect(0, 0, 0, 0),
      container: rect(0, 0, 100, 600)
    })

    expect(placement.left).toBe(EDGE)
  })
})

describe('selectionPlacement', () => {
  function contents(getSelection?: () => EpubSelection | null, frameElement?: unknown): EpubContents {
    return {
      window: {
        getSelection,
        frameElement: frameElement as { getBoundingClientRect(): DOMRect } | null
      }
    }
  }

  function selectionOf(selectionRect: RectLike): EpubSelection {
    return {
      rangeCount: 1,
      toString: () => '摘录',
      getRangeAt: () => ({ getBoundingClientRect: () => asRect(selectionRect) })
    }
  }

  const container = {
    getBoundingClientRect: () => asRect(CONTAINER)
  }

  it('取不到 window 时返回 null，浮条不弹', () => {
    expect(selectionPlacement({}, container)).toBeNull()
  })

  it('没有选区时返回 null', () => {
    expect(selectionPlacement(contents(() => null, null), container)).toBeNull()
  })

  it('折叠成光标（rangeCount 为 0）时返回 null', () => {
    const collapsed: EpubSelection = { rangeCount: 0, toString: () => '', getRangeAt: vi.fn() }
    expect(selectionPlacement(contents(() => collapsed, null), container)).toBeNull()
  })

  it('拿不到 iframe 元素时返回 null，宁可没有浮条也不算出错误坐标', () => {
    const frame = { getBoundingClientRect: () => asRect(rect(0, 0, 0, 0)) }
    expect(selectionPlacement(contents(() => selectionOf(rect(300, 100, 80, 20)), null), container)).toBeNull()
    expect(selectionPlacement(contents(() => selectionOf(rect(300, 100, 80, 20)), frame), container)).toEqual({
      top: 300 - TOOLBAR_HEIGHT - GAP,
      left: 100 + 40 - TOOLBAR_WIDTH / 2,
      fallback: false
    })
  })
})

/** jsdom 会把十六进制归一成自己的写法，所以拿探针元素做同一次归一化再比，避免断言写死写法。 */
function normalizedStyle(property: 'background', value: string): string {
  const probe = document.createElement('div')
  probe.style[property] = value
  return probe.style[property]
}

describe('SelectionToolbar', () => {
  const placement = { top: 10, left: 20, fallback: false }

  function renderToolbar(activeColor: HighlightColor | null) {
    // 参数只用于把 mock 的实参类型固定下来，实现是空的（noUnusedParameters 要求下划线前缀）
    const onPickColor = vi.fn((_color: HighlightColor) => {})
    const onRemoveHighlight = vi.fn(() => {})
    const onDismiss = vi.fn(() => {})

    const view = render(
      <SelectionToolbar
        placement={placement}
        activeColor={activeColor}
        onPickColor={onPickColor}
        onRemoveHighlight={onRemoveHighlight}
        onDismiss={onDismiss}
      />
    )

    return { view, onPickColor, onRemoveHighlight, onDismiss }
  }

  /** 色块是浮条上唯一带 aria-pressed 的控件，按属性取比按类名取更不容易被改样式带崩。 */
  function swatches(): HTMLElement[] {
    return screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed'))
  }

  it('渲染出的色块个数与 HIGHLIGHT_COLORS 一致，色值取自 highlightPalette', () => {
    renderToolbar(null)

    const toolbar = screen.getByRole('toolbar', { name: '选中文字的操作' })
    expect(toolbar).toHaveStyle({ top: '10px', left: '20px' })

    // 个数必须对齐配色表：TOOLBAR_WIDTH 的算式按 HIGHLIGHT_COLORS.length 推宽，
    // 少画一个色块浮条就会比常量窄，夹取范围跟着错位。
    const buttons = swatches()
    expect(buttons).toHaveLength(HIGHLIGHT_COLORS.length)
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(
      HIGHLIGHT_COLORS.map((color) => HIGHLIGHT_COLOR_LABELS[color])
    )

    for (const color of HIGHLIGHT_COLORS) {
      // 用可访问名查色块：名字对不上说明 aria-label 没落到对应的那个色块上
      const swatch = screen.getByRole<HTMLButtonElement>('button', {
        name: HIGHLIGHT_COLOR_LABELS[color]
      })
      expect(swatch.style.background).toBe(normalizedStyle('background', highlightFill(color)))
    }
  })

  it('选区上没有划线时四个色块都不带选中态，删除划线不可点', () => {
    renderToolbar(null)

    for (const button of swatches()) {
      expect(button).toHaveAttribute('aria-pressed', 'false')
    }
    expect(screen.getByRole('button', { name: '删除划线' })).toBeDisabled()
    expect(screen.queryByText('✓')).not.toBeInTheDocument()
  })

  it('选区上的划线是绿色时只有绿色被按下，删除划线可点', () => {
    renderToolbar('green')

    const pressed = swatches().filter((button) => button.getAttribute('aria-pressed') === 'true')

    expect(pressed).toHaveLength(1)
    expect(pressed[0]).toHaveAttribute('aria-label', HIGHLIGHT_COLOR_LABELS.green)
    expect(screen.getByRole('button', { name: '删除划线' })).toBeEnabled()
    expect(screen.getByText('✓')).toBeInTheDocument()
  })

  it('点哪个色块就回传哪个颜色，不惊动删除与取消', () => {
    const { onPickColor, onRemoveHighlight, onDismiss } = renderToolbar(null)

    for (const color of HIGHLIGHT_COLORS) {
      fireEvent.click(screen.getByRole('button', { name: HIGHLIGHT_COLOR_LABELS[color] }))
    }

    expect(onPickColor.mock.calls.map(([color]) => color)).toEqual([...HIGHLIGHT_COLORS])
    expect(onRemoveHighlight).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  // 复现审查里的 M3：色块的可访问名一度要靠「✓」的内容或 title 回落去算，
  // 选中态一变名字就跟着变，读屏用户听到的控件名字会莫名多一个勾。
  // 名字必须恒定来自 aria-label，与选中态、与色块里的内容都无关。
  it('色块的可访问名恒定为配色中文名，不随选中态与内容变', () => {
    const { view } = renderToolbar(null)

    expect(screen.getByRole('button', { name: HIGHLIGHT_COLOR_LABELS.green })).toBeInTheDocument()

    view.rerender(
      <SelectionToolbar
        placement={placement}
        activeColor="green"
        onPickColor={vi.fn(() => {})}
        onRemoveHighlight={vi.fn(() => {})}
        onDismiss={vi.fn(() => {})}
      />
    )

    // 名字仍是「绿色」而控件里确实多了个「✓」—— 精确匹配能命中，说明勾没被算进名字。
    const swatch = screen.getByRole('button', { name: HIGHLIGHT_COLOR_LABELS.green })
    expect(swatch).toHaveAttribute('aria-label', HIGHLIGHT_COLOR_LABELS.green)
    expect(swatch).toHaveTextContent('✓')
  })

  it('删除划线与取消各自回调，互不串台，无划线时删除点了也没反应', () => {
    const idle = renderToolbar(null)

    expect(screen.getByRole('button', { name: '删除划线' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '删除划线' }))
    expect(idle.onRemoveHighlight).not.toHaveBeenCalled()
    expect(idle.onDismiss).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(idle.onDismiss).toHaveBeenCalledTimes(1)
    expect(idle.onRemoveHighlight).not.toHaveBeenCalled()

    idle.view.unmount()

    const active = renderToolbar('green')

    fireEvent.click(screen.getByRole('button', { name: '删除划线' }))
    expect(active.onRemoveHighlight).toHaveBeenCalledTimes(1)
    expect(active.onDismiss).not.toHaveBeenCalled()
    expect(active.onPickColor).not.toHaveBeenCalled()
  })
})
