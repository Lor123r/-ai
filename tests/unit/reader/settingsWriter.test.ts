import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from '@core/domain/settings'
import { SETTINGS_SAVE_INTERVAL_MS, createSettingsWriter } from '@renderer/reader/settingsWriter'

afterEach(() => {
  vi.useRealTimers()
})

function settings(patch: Partial<ReaderSettings> = {}): ReaderSettings {
  return { ...DEFAULT_READER_SETTINGS, ...patch }
}

/** 每次读时间都往前走，用来让「距上次落盘够久」恒成立。 */
function tickingClock(stepMs = 1000): () => number {
  let value = 0
  return () => (value += stepMs)
}

describe('createSettingsWriter', () => {
  it('第一次改动立刻落盘', async () => {
    const save = vi.fn(async () => undefined)
    const writer = createSettingsWriter({ save, now: tickingClock() })

    writer.push(settings({ fontSize: 20 }))
    await writer.dispose()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(settings({ fontSize: 20 }))
  })

  it('连点加减只在停顿后落盘一次，写的是最终值', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createSettingsWriter({ save, now: () => 0 })

    writer.push(settings({ fontSize: 19 }))
    writer.push(settings({ fontSize: 20 }))
    writer.push(settings({ fontSize: 21 }))
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SETTINGS_SAVE_INTERVAL_MS)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(settings({ fontSize: 21 }))
    await writer.dispose()
  })

  it('等价的设置重复推送不会写盘（避免无谓的磁盘写）', async () => {
    const save = vi.fn(async () => undefined)
    const writer = createSettingsWriter({ save, now: tickingClock() })

    writer.push(settings())
    writer.push(settings())
    await writer.dispose()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('任一项设置变化都会写盘', async () => {
    const save = vi.fn(async () => undefined)
    const writer = createSettingsWriter({ save, now: tickingClock() })

    writer.push(settings({ theme: 'night' }))
    writer.push(settings({ theme: 'night', fontFamily: 'sans' }))
    writer.push(settings({ theme: 'night', fontFamily: 'sans', pageMargin: 40 }))
    await writer.dispose()

    expect(save).toHaveBeenCalledTimes(3)
  })

  it('可以收紧最小间隔，便于测试或按需调整手感', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createSettingsWriter({ save, now: () => 0, minIntervalMs: 10 })

    writer.push(settings({ fontSize: 19 }))
    await vi.advanceTimersByTimeAsync(10)

    expect(save).toHaveBeenCalledTimes(1)
    await writer.dispose()
  })

  it('关闭面板时把还没来得及写的设置补上，避免丢最后一次改动', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createSettingsWriter({ save, now: () => 0 })

    writer.push(settings({ fontSize: 24 }))
    await writer.dispose()

    expect(save).toHaveBeenCalledWith(settings({ fontSize: 24 }))
  })

  it('落盘失败交给 onError，不影响用户继续调整', async () => {
    const failure = new Error('磁盘满了')
    const onError = vi.fn()
    const writer = createSettingsWriter({
      save: () => Promise.reject(failure),
      onError,
      now: tickingClock()
    })

    writer.push(settings({ fontSize: 30 }))

    await expect(writer.dispose()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(failure)
  })
})
