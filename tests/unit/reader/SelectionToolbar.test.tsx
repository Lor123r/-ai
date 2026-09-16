import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SelectionToolbar, {
  placeSelectionToolbar,
  selectionPlacement,
  type RectLike
} from '@renderer/reader/SelectionToolbar'
import type { EpubContents, EpubSelection } from '@renderer/reader/createEpubBook'

/** 浮条自身的尺寸与留白，抄自 SelectionToolbar 的私有常量：断言要能算出具体数字。 */
const TOOLBAR_WIDTH = 148
const TOOLBAR_HEIGHT = 34
const GAP = 8
const EDGE = 8

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

describe('SelectionToolbar', () => {
  const placement = { top: 10, left: 20, fallback: false }

  it('渲染两个动作，并且带上浮条应有的语义', () => {
    render(
      <SelectionToolbar placement={placement} highlighted={false} onHighlight={vi.fn()} onDismiss={vi.fn()} />
    )

    const toolbar = screen.getByRole('toolbar', { name: '选中文字的操作' })
    expect(toolbar).toHaveStyle({ top: '10px', left: '20px' })
    expect(screen.getByRole('button', { name: '划线' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  })

  it('同一段选区已有划线时主按钮变成删除', () => {
    render(
      <SelectionToolbar placement={placement} highlighted={true} onHighlight={vi.fn()} onDismiss={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: '删除划线' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '划线' })).not.toBeInTheDocument()
  })

  it('两个按钮各自回调，且不把点击互相串起来', () => {
    const onHighlight = vi.fn()
    const onDismiss = vi.fn()
    render(
      <SelectionToolbar placement={placement} highlighted={false} onHighlight={onHighlight} onDismiss={onDismiss} />
    )

    fireEvent.click(screen.getByRole('button', { name: '划线' }))
    expect(onHighlight).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onHighlight).toHaveBeenCalledTimes(1)
  })
})
