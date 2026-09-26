import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NARROW_VIEWPORT_MAX_WIDTH,
  useChromeVisibility
} from '@renderer/reader/useChromeVisibility'

/**
 * 顶栏/底栏的初始显隐。
 *
 * 为什么值得单测：这个判断只在挂载时算一次，E2E 里改视口尺寸也改不动它
 * （Playwright 的 setViewportSize 发生在页面加载之后）。而「手机上顶栏默认挂着」
 * 正是真机上暴露过的问题，所以要在能控制 window.innerWidth 的地方钉住。
 */

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useChromeVisibility', () => {
  it('窄屏默认收起，把高度留给正文', () => {
    setViewportWidth(360)
    const { result } = renderHook(() => useChromeVisibility())
    expect(result.current.chromeVisible).toBe(false)
  })

  it('宽屏默认展开，鼠标用户不必先点一下才看得到按钮', () => {
    setViewportWidth(1280)
    const { result } = renderHook(() => useChromeVisibility())
    expect(result.current.chromeVisible).toBe(true)
  })

  it('断点边界：等于断点算窄屏，多一像素算宽屏', () => {
    setViewportWidth(NARROW_VIEWPORT_MAX_WIDTH)
    expect(renderHook(() => useChromeVisibility()).result.current.chromeVisible).toBe(false)

    setViewportWidth(NARROW_VIEWPORT_MAX_WIDTH + 1)
    expect(renderHook(() => useChromeVisibility()).result.current.chromeVisible).toBe(true)
  })

  it('toggleChrome 来回切换', () => {
    setViewportWidth(360)
    const { result } = renderHook(() => useChromeVisibility())
    expect(result.current.chromeVisible).toBe(false)

    act(() => result.current.toggleChrome())
    expect(result.current.chromeVisible).toBe(true)

    act(() => result.current.toggleChrome())
    expect(result.current.chromeVisible).toBe(false)
  })

  it('挂载后改视口尺寸不会重置用户的选择', () => {
    setViewportWidth(360)
    const { result } = renderHook(() => useChromeVisibility())

    // 用户手动唤出顶栏
    act(() => result.current.toggleChrome())
    expect(result.current.chromeVisible).toBe(true)

    // 旋转屏幕 / 拖动窗口：不该把用户刚唤出的顶栏又收回去
    setViewportWidth(1280)
    act(() => result.current.toggleChrome())
    act(() => result.current.toggleChrome())
    expect(result.current.chromeVisible).toBe(true)
  })
})
