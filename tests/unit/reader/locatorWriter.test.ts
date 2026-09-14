import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocator, type ReadingLocator } from '@core/domain/progress'
import { LOCATOR_SAVE_INTERVAL_MS, createLocatorWriter } from '@renderer/reader/locatorWriter'

afterEach(() => {
  vi.useRealTimers()
})

function locator(cfi: string, percent = 0, chapterIndex = 0): ReadingLocator {
  return createLocator({ cfi, percent, chapterIndex }, 1)
}

/** 每次读时间都往前走，用来让「距上次落盘够久」恒成立。 */
function tickingClock(stepMs = 1000): () => number {
  let value = 0
  return () => (value += stepMs)
}

describe('createLocatorWriter', () => {
  it('距上次落盘够久时立刻写盘，不必等最小间隔', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createLocatorWriter({ save, now: tickingClock() })

    writer.push(locator('a'))
    // 只放行微任务、不放行定时器：写盘不该依赖最小间隔到期
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(locator('a'))
    await writer.dispose()
  })

  it('同一位置重复上报只写一次', async () => {
    const save = vi.fn(async () => undefined)
    const writer = createLocatorWriter({ save, now: tickingClock() })

    writer.push(locator('a'))
    writer.push(locator('a'))
    writer.push(locator('a'))
    await writer.dispose()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('间隔内连续翻页合并成一次写，写的是最后停留的位置', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createLocatorWriter({ save, now: () => 0 })
    const first = locator('a', 0.1)
    const second = locator('b', 0.2)

    writer.push(first)
    await vi.advanceTimersByTimeAsync(0)
    expect(save).not.toHaveBeenCalled()

    writer.push(second)
    await vi.advanceTimersByTimeAsync(LOCATOR_SAVE_INTERVAL_MS)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(second)
    await writer.dispose()
  })

  it('间隔足够时连续上报各写一次，且顺序不乱', async () => {
    const save = vi.fn(async () => undefined)
    const writer = createLocatorWriter({ save, now: tickingClock() })

    writer.push(locator('a', 0.1))
    writer.push(locator('b', 0.2))
    await writer.dispose()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(1, locator('a', 0.1))
    expect(save).toHaveBeenNthCalledWith(2, locator('b', 0.2))
  })

  it('dispose 会把还没落盘的进度补上，之后不再接受新位置', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createLocatorWriter({ save, now: () => 0 })

    writer.push(locator('a', 0.1))
    await writer.dispose()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(locator('a', 0.1))

    writer.push(locator('b', 0.9))
    await vi.advanceTimersByTimeAsync(LOCATOR_SAVE_INTERVAL_MS)

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('没有待写内容时 dispose 是空操作', async () => {
    const save = vi.fn(async () => undefined)
    const writer = createLocatorWriter({ save, now: tickingClock() })

    await writer.dispose()

    expect(save).not.toHaveBeenCalled()
  })

  it('写盘失败交给 onError，不往外抛', async () => {
    const failure = new Error('磁盘满了')
    const onError = vi.fn()
    const writer = createLocatorWriter({
      save: () => Promise.reject(failure),
      onError,
      now: tickingClock()
    })

    writer.push(locator('a'))

    await expect(writer.dispose()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('写操作串成一条链，前一次没写完不会开始下一次', async () => {
    let release: () => void = () => undefined
    const save = vi.fn((target: ReadingLocator) => {
      if (target.cfi === 'a') return new Promise<void>((resolve) => (release = resolve))
      return Promise.resolve()
    })
    const writer = createLocatorWriter({ save, now: tickingClock() })

    writer.push(locator('a'))
    writer.push(locator('b'))

    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1)
    })

    release()
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2)
    })
    expect(save).toHaveBeenLastCalledWith(locator('b'))
    await writer.dispose()
  })
})
