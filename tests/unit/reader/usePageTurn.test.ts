import { renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePageTurn } from '@renderer/reader/usePageTurn'

/**
 * 翻页手势的判定规则。
 *
 * 为什么在 jsdom 里测而不是只靠 E2E：E2E 能证明「划一下会翻页」，但很难覆盖
 * 边界 —— 斜着划、划得太慢、正在选词、多指按下。这些恰恰是最容易误翻页的地方，
 * 而误翻页在真机上表现为「读着读着跳页了」，很难复现。这里把每条规则单独钉住。
 *
 * 手势监听绑在 document 上，所以直接往 document 派发 PointerEvent 即可，
 * 不需要真的渲染出正文。
 */

const CONTAINER_WIDTH = 400
const CONTAINER_LEFT = 0

function makeContainer(): HTMLDivElement {
  const element = document.createElement('div')
  document.body.append(element)
  // jsdom 不做布局，getBoundingClientRect 恒为 0，这里给出确定的分区依据
  element.getBoundingClientRect = () =>
    ({
      x: CONTAINER_LEFT,
      y: 0,
      left: CONTAINER_LEFT,
      top: 0,
      right: CONTAINER_LEFT + CONTAINER_WIDTH,
      bottom: 600,
      width: CONTAINER_WIDTH,
      height: 600,
      toJSON: () => ({})
    }) as DOMRect
  return element
}

function pointer(
  type: string,
  x: number,
  y: number,
  button = 0,
  view: Window | null = null
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true
  })
  // jsdom 的 PointerEvent 构造器不接受 view（会抛 "member view is not of type
  // Window"），但真实浏览器里 iframe 内的事件 view 就是 iframe 自己的 window。
  // 这里在实例上补一个，让 `iframeOffsetFor` 的判定能被真实地驱动。
  if (view) Object.defineProperty(event, 'view', { value: view, configurable: true })
  return event
}

/** 一次完整手势：按下 → 抬起。 */
function perform(from: { x: number; y: number }, to: { x: number; y: number }): void {
  document.dispatchEvent(pointer('pointerdown', from.x, from.y))
  document.dispatchEvent(pointer('pointerup', to.x, to.y))
}

interface Harness {
  onMove: ReturnType<typeof vi.fn>
  onToggleChrome: ReturnType<typeof vi.fn>
  unmount: () => void
}

function mount(
  options: {
    disabled?: boolean
    innerDocument?: Document | null
    viewport?: HTMLElement | null
  } = {}
): Harness {
  const container = makeContainer()
  const ref = createRef<HTMLDivElement>()
  Object.defineProperty(ref, 'current', { value: container, writable: true })

  const viewportRef = createRef<HTMLDivElement>()
  Object.defineProperty(viewportRef, 'current', {
    value: options.viewport ?? null,
    writable: true
  })

  const onMove = vi.fn()
  const onToggleChrome = vi.fn()

  const { unmount } = renderHook(() =>
    usePageTurn({
      targetRef: ref,
      viewportRef,
      innerDocument: options.innerDocument ?? null,
      onMove,
      onToggleChrome,
      disabled: options.disabled ?? false
    })
  )

  return { onMove, onToggleChrome, unmount }
}

beforeEach(() => {
  // 每个用例都从「没有选区」开始，避免上一条的选区影响判定
  window.getSelection()?.removeAllRanges()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('usePageTurn 滑动', () => {
  it('向左滑动翻到下一页', () => {
    const { onMove } = mount()
    perform({ x: 300, y: 300 }, { x: 100, y: 300 })
    expect(onMove).toHaveBeenCalledWith('next')
  })

  it('向右滑动翻回上一页', () => {
    const { onMove } = mount()
    perform({ x: 100, y: 300 }, { x: 300, y: 300 })
    expect(onMove).toHaveBeenCalledWith('prev')
  })

  it('位移不足阈值不算滑动，也不当点击（落在中间区）', () => {
    const { onMove, onToggleChrome } = mount()
    // 横向只走了 20px，低于 24px 阈值；但纵向也走了 20px，超过点击容差
    perform({ x: 200, y: 300 }, { x: 220, y: 320 })
    expect(onMove).not.toHaveBeenCalled()
    expect(onToggleChrome).not.toHaveBeenCalled()
  })

  it('斜着划不算滑动：横向位移必须明显大于纵向', () => {
    const { onMove } = mount()
    // 横向 60px 够了，但纵向也有 60px，比例 1.0 < 1.2
    perform({ x: 300, y: 200 }, { x: 240, y: 260 })
    expect(onMove).not.toHaveBeenCalled()
  })

  it('按住太久再划不算滑动', () => {
    const { onMove } = mount()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(0) // pointerdown
    now.mockReturnValueOnce(5000) // pointerup，超过 800ms
    perform({ x: 300, y: 300 }, { x: 100, y: 300 })
    expect(onMove).not.toHaveBeenCalled()
  })

  it('一次滑动只翻一页，抬起不再触发点击', () => {
    const { onMove, onToggleChrome } = mount()
    // 从最右划到最左：起点在「下一页」区，终点在「上一页」区。
    // 若抬起又被当成点击，会多出一次 prev。
    perform({ x: 390, y: 300 }, { x: 10, y: 300 })
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove).toHaveBeenCalledWith('next')
    expect(onToggleChrome).not.toHaveBeenCalled()
  })
})

describe('usePageTurn 点击分区', () => {
  it('点左侧 30% 翻上一页', () => {
    const { onMove } = mount()
    perform({ x: 40, y: 300 }, { x: 40, y: 300 })
    expect(onMove).toHaveBeenCalledWith('prev')
  })

  it('点右侧 30% 翻下一页', () => {
    const { onMove } = mount()
    perform({ x: 360, y: 300 }, { x: 360, y: 300 })
    expect(onMove).toHaveBeenCalledWith('next')
  })

  it('点中间 40% 唤出工具栏，不翻页', () => {
    const { onMove, onToggleChrome } = mount()
    perform({ x: 200, y: 300 }, { x: 200, y: 300 })
    expect(onToggleChrome).toHaveBeenCalledTimes(1)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('分区按容器宽度算，不是按视口宽度', () => {
    const { onMove } = mount()
    // 容器宽 400，左边界 0：x=120 正好是 30% 边界，算左侧
    perform({ x: 120, y: 300 }, { x: 120, y: 300 })
    expect(onMove).toHaveBeenCalledWith('prev')
  })
})

describe('usePageTurn 不该翻页的情况', () => {
  it('正在选词时不翻页', () => {
    const { onMove, onToggleChrome } = mount()

    // 造一个非折叠选区：长按选词、拖选择手柄都会走到这里
    const text = document.createTextNode('一段正文')
    document.body.append(text)
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    perform({ x: 360, y: 300 }, { x: 360, y: 300 })
    expect(onMove).not.toHaveBeenCalled()
    expect(onToggleChrome).not.toHaveBeenCalled()
  })

  it('非主键（右键）不参与翻页', () => {
    const { onMove } = mount()
    document.dispatchEvent(pointer('pointerdown', 360, 300, 2))
    document.dispatchEvent(pointer('pointerup', 360, 300, 2))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('没有按下就抬起，不翻页', () => {
    const { onMove } = mount()
    document.dispatchEvent(pointer('pointerup', 360, 300))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('pointercancel 之后抬起不翻页', () => {
    const { onMove } = mount()
    document.dispatchEvent(pointer('pointerdown', 360, 300))
    document.dispatchEvent(pointer('pointercancel', 360, 300))
    document.dispatchEvent(pointer('pointerup', 360, 300))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('disabled 时整个手势层停用', () => {
    const { onMove, onToggleChrome } = mount({ disabled: true })
    perform({ x: 360, y: 300 }, { x: 360, y: 300 })
    perform({ x: 300, y: 300 }, { x: 100, y: 300 })
    expect(onMove).not.toHaveBeenCalled()
    expect(onToggleChrome).not.toHaveBeenCalled()
  })
})

/*
 * 监听绑在整个 document 上，所以 UI 自己的点击也会流进来。
 * 不排除的话，点「下一页」按钮会先翻页、再被当成点击中间区把顶栏收起来，
 * 表现为按钮失灵 —— 真机上就是这么暴露的。
 */
describe('usePageTurn 不接管 UI 上的点击', () => {
  function performOn(element: Element, x: number, y: number): void {
    element.dispatchEvent(pointer('pointerdown', x, y))
    element.dispatchEvent(pointer('pointerup', x, y))
  }

  it('点顶栏按钮不翻页也不收起顶栏', () => {
    const { onMove, onToggleChrome } = mount()
    const header = document.createElement('header')
    header.className = 'reader__header'
    const button = document.createElement('button')
    button.textContent = '下一页'
    header.append(button)
    document.body.append(header)

    performOn(button, 200, 20)
    expect(onMove).not.toHaveBeenCalled()
    expect(onToggleChrome).not.toHaveBeenCalled()
  })

  it('点底栏按钮不翻页', () => {
    const { onMove, onToggleChrome } = mount()
    const footer = document.createElement('footer')
    footer.className = 'reader__controls'
    const button = document.createElement('button')
    footer.append(button)
    document.body.append(footer)

    performOn(button, 200, 780)
    expect(onMove).not.toHaveBeenCalled()
    expect(onToggleChrome).not.toHaveBeenCalled()
  })

  it('点抽屉里的目录项不翻页', () => {
    const { onMove, onToggleChrome } = mount()
    const drawer = document.createElement('aside')
    drawer.className = 'reader__drawer'
    const link = document.createElement('a')
    link.textContent = '第一章'
    drawer.append(link)
    document.body.append(drawer)

    performOn(link, 200, 300)
    expect(onMove).not.toHaveBeenCalled()
    expect(onToggleChrome).not.toHaveBeenCalled()
  })

  it('点正文（非交互元素）照常翻页', () => {
    const { onMove } = mount()
    const paragraph = document.createElement('p')
    paragraph.textContent = '正文'
    document.body.append(paragraph)

    performOn(paragraph, 360, 300)
    expect(onMove).toHaveBeenCalledWith('next')
  })
})

describe('usePageTurn iframe 绑定', () => {
  it('绑到 iframe 的 document 上，正文里的手势才收得到', () => {
    const inner = document.implementation.createHTMLDocument('inner')
    const { onMove } = mount({ innerDocument: inner })

    // 事件派发在 iframe 内部，父文档的监听收不到 —— 这正是必须绑两层的原因
    inner.dispatchEvent(pointer('pointerdown', 360, 300))
    inner.dispatchEvent(pointer('pointerup', 360, 300))

    expect(onMove).toHaveBeenCalledWith('next')
  })

  it('卸载时把 iframe 上的监听摘干净', () => {
    const inner = document.implementation.createHTMLDocument('inner')
    const { onMove, unmount } = mount({ innerDocument: inner })
    unmount()

    inner.dispatchEvent(pointer('pointerdown', 360, 300))
    inner.dispatchEvent(pointer('pointerup', 360, 300))
    expect(onMove).not.toHaveBeenCalled()
  })
})

/*
 * epub.js 的 paginated 流把整章排成一条很宽的横条（真机实测 7400px），
 * 靠横向滚动一次露一栏，由 `.reader__viewport` 的 overflow: hidden 裁掉其余部分。
 *
 * 于是 iframe 内部的 clientX 相对的是那条 7400px 视口，外层文档的 clientX
 * 才是相对屏幕的 —— **两个坐标系**。混用会让 ratio 恒大于 1，点正文任何位置
 * 都判成「下一页」，表现为「不能向前翻页」。
 *
 * 这里把真机上的数字搬进来：视口宽 360、iframe left = -560、内部宽 7400。
 * 屏幕坐标 x 与 iframe 内部坐标的关系是 `innerX = screenX - IFRAME_LEFT`。
 */
describe('usePageTurn iframe 坐标系', () => {
  const VIEWPORT_WIDTH = 360
  const IFRAME_LEFT = -560
  const IFRAME_WIDTH = 7400

  function rect(left: number, width: number): DOMRect {
    return {
      x: left,
      y: 0,
      left,
      top: 0,
      right: left + width,
      bottom: 600,
      width,
      height: 600,
      toJSON: () => ({})
    } as DOMRect
  }

  /** 造一个「正文列 + 里面一条超宽 iframe」的布局，数字取自真机。 */
  function mountWithWideIframe(): Harness & { inner: Document } {
    const viewport = document.createElement('div')
    viewport.className = 'reader__viewport'
    viewport.getBoundingClientRect = () => rect(0, VIEWPORT_WIDTH)

    const frame = document.createElement('iframe')
    frame.getBoundingClientRect = () => rect(IFRAME_LEFT, IFRAME_WIDTH)
    viewport.append(frame)
    document.body.append(viewport)

    const inner = document.implementation.createHTMLDocument('inner')
    // jsdom 的 createHTMLDocument 不给 defaultView（恒为 null），而真实 iframe
    // 有自己独立的 window。补上它，`iframeOffsetFor` 里
    // `event.view === innerDocument.defaultView` 这条判定才有区分度 ——
    // 否则外层事件与 iframe 事件都满足，偏移会被重复叠加。
    Object.defineProperty(inner, 'defaultView', {
      value: document.defaultView,
      configurable: true
    })

    return { ...mount({ innerDocument: inner, viewport }), inner }
  }

  /** 在 iframe 内部点一下。`screenX` 是屏幕坐标，内部坐标由它换算。 */
  function tapAtScreen(inner: Document, screenX: number): void {
    const innerX = screenX - IFRAME_LEFT
    inner.dispatchEvent(pointer('pointerdown', innerX, 300, 0, inner.defaultView))
    inner.dispatchEvent(pointer('pointerup', innerX, 300, 0, inner.defaultView))
  }

  it('屏幕左侧的点击判成上一页，而不是下一页', () => {
    const { onMove, inner } = mountWithWideIframe()
    tapAtScreen(inner, 40)
    expect(onMove).toHaveBeenCalledWith('prev')
  })

  it('屏幕右侧的点击判成下一页', () => {
    const { onMove, inner } = mountWithWideIframe()
    tapAtScreen(inner, 320)
    expect(onMove).toHaveBeenCalledWith('next')
  })

  it('屏幕中间的点击唤出工具栏', () => {
    const { onMove, onToggleChrome, inner } = mountWithWideIframe()
    tapAtScreen(inner, 180)
    expect(onToggleChrome).toHaveBeenCalledTimes(1)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('iframe 里的滑动也换算到屏幕坐标：dx 不再被 7400px 视口放大', () => {
    const { onMove, inner } = mountWithWideIframe()
    // 屏幕 x=300 → x=100，往左划 200px，是「下一页」
    inner.dispatchEvent(pointer('pointerdown', 300 - IFRAME_LEFT, 300, 0, inner.defaultView))
    inner.dispatchEvent(pointer('pointerup', 100 - IFRAME_LEFT, 300, 0, inner.defaultView))
    expect(onMove).toHaveBeenCalledWith('next')
  })

  it('按下在外层、抬起在 iframe 里，dx 仍然算得对', () => {
    const { onMove, inner } = mountWithWideIframe()
    // 外层按下（屏幕坐标 300），iframe 里抬起（屏幕坐标 100）
    document.dispatchEvent(pointer('pointerdown', 300, 300))
    inner.dispatchEvent(pointer('pointerup', 100 - IFRAME_LEFT, 300, 0, inner.defaultView))
    expect(onMove).toHaveBeenCalledWith('next')
  })
})
