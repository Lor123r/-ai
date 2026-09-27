import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  READER_STATE,
  handleBackPress,
  isReaderState,
  useBackNavigation
} from '@renderer/reader/useBackNavigation'

/**
 * 返回键的分发规则。
 *
 * 安卓原生返回键与浏览器后退共用这一份判定：App 收到事件后先问阅读器
 * 「这次返回你要不要」，要就交给它（比如关抽屉），不要才回书架。
 *
 * 为什么单独测：`handleBackPress` 是两条入口（`popstate` 与
 * `@capacitor/app` 的 `backButton`）唯一的共同分支依据。原生事件在
 * Electron 里发不出来，E2E 覆盖不到，但这条判定本身可以在这里钉死。
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isReaderState', () => {
  it('认出阅读器那一层', () => {
    expect(isReaderState(READER_STATE)).toBe(true)
  })

  it('书架那一层（无 state）不算阅读器', () => {
    expect(isReaderState(null)).toBe(false)
    expect(isReaderState(undefined)).toBe(false)
  })

  it('别的 state 不算阅读器', () => {
    expect(isReaderState({ view: 'shelf' })).toBe(false)
    expect(isReaderState({})).toBe(false)
    expect(isReaderState('reader')).toBe(false)
    expect(isReaderState(42)).toBe(false)
  })
})

describe('handleBackPress', () => {
  it('没有阅读器登记时返回 false，交给 App 回书架', () => {
    expect(handleBackPress()).toBe(false)
  })

  it('阅读器登记后由它决定：返回 true 表示接管', () => {
    const onBack = vi.fn(() => true)
    const { unmount } = renderHook(() => useBackNavigation({ onBack }))

    expect(handleBackPress()).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('阅读器说「没我什么事」时返回 false', () => {
    const onBack = vi.fn(() => false)
    const { unmount } = renderHook(() => useBackNavigation({ onBack }))

    expect(handleBackPress()).toBe(false)

    unmount()
  })

  it('卸载后不再接管，避免卸载的阅读器继续吃掉返回键', () => {
    const onBack = vi.fn(() => true)
    const { unmount } = renderHook(() => useBackNavigation({ onBack }))
    unmount()

    expect(handleBackPress()).toBe(false)
    expect(onBack).not.toHaveBeenCalled()
  })

  it('每次返回都问最新的回调，不缓存第一次的', () => {
    const first = vi.fn(() => true)
    const second = vi.fn(() => false)

    const { rerender, unmount } = renderHook(
      ({ onBack }: { onBack: () => boolean }) => useBackNavigation({ onBack }),
      { initialProps: { onBack: first } }
    )

    expect(handleBackPress()).toBe(true)

    rerender({ onBack: second })
    expect(handleBackPress()).toBe(false)
    expect(second).toHaveBeenCalledTimes(1)

    unmount()
  })
})
