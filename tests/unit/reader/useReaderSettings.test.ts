import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InMemorySettingsRepository } from '@core/adapters/inMemorySettingsRepository'
import { DEFAULT_READER_SETTINGS, READER_LIMITS, type ReaderSettings } from '@core/domain/settings'
import type { SettingsRepository } from '@core/ports/settingsRepository'
import { useReaderSettings } from '@renderer/reader/useReaderSettings'

/** 每次读时间都往前走，让「距上次落盘够久」恒成立，测试不必等真实节流窗口。 */
function tickingClock(stepMs = 1000): () => number {
  let value = 0
  return () => (value += stepMs)
}

/** 时钟停在 0：所有改动都落进同一个节流窗口，便于验证合并与补写。 */
function frozenClock(): () => number {
  return () => 0
}

function requireSettings(settings: ReaderSettings | null): ReaderSettings {
  if (!settings) throw new Error('设置还没读出来')
  return settings
}

describe('useReaderSettings', () => {
  it('读到设置之前是 null，调用方据此避免先用默认值渲染一次', async () => {
    const now = tickingClock()
    const { result } = renderHook(() => useReaderSettings(new InMemorySettingsRepository(), now))

    expect(result.current.settings).toBeNull()
    await waitFor(() => {
      expect(result.current.settings).toEqual(DEFAULT_READER_SETTINGS)
    })
  })

  it('读到已保存的设置', async () => {
    const now = tickingClock()
    const repository = new InMemorySettingsRepository({ fontSize: 24, theme: 'night' })
    const { result } = renderHook(() => useReaderSettings(repository, now))

    await waitFor(() => {
      expect(result.current.settings).toMatchObject({ fontSize: 24, theme: 'night' })
    })
  })

  it('读取失败时回落到默认设置，而不是让阅读器卡在加载态', async () => {
    const now = tickingClock()
    const failing: SettingsRepository = {
      load: () => Promise.reject(new Error('配置损坏')),
      save: () => Promise.resolve()
    }
    const { result } = renderHook(() => useReaderSettings(failing, now))

    await waitFor(() => {
      expect(result.current.settings).toEqual(DEFAULT_READER_SETTINGS)
    })
  })

  it('update 立即反映到 settings，并按当前设置合并补丁', async () => {
    const now = tickingClock()
    const { result } = renderHook(() => useReaderSettings(new InMemorySettingsRepository(), now))
    await waitFor(() => {
      expect(result.current.settings).not.toBeNull()
    })

    act(() => result.current.update({ fontSize: 26 }))

    expect(result.current.settings).toMatchObject({
      fontSize: 26,
      theme: DEFAULT_READER_SETTINGS.theme,
      pageMargin: DEFAULT_READER_SETTINGS.pageMargin
    })
  })

  it('越界补丁被夹紧后才落盘，脏数据进不了存档', async () => {
    const now = tickingClock()
    const repository = new InMemorySettingsRepository()
    const save = vi.spyOn(repository, 'save')
    const { result } = renderHook(() => useReaderSettings(repository, now))
    await waitFor(() => {
      expect(result.current.settings).not.toBeNull()
    })

    act(() => result.current.update({ fontSize: 1_000 }))

    expect(requireSettings(result.current.settings).fontSize).toBe(READER_LIMITS.fontSize.max)
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1)
    })
    await expect(repository.load()).resolves.toMatchObject({ fontSize: READER_LIMITS.fontSize.max })
  })

  it('连续改动合并成一次落盘，写的是最后停留的值', async () => {
    const now = frozenClock()
    const repository = new InMemorySettingsRepository()
    const save = vi.spyOn(repository, 'save')
    const { result, unmount } = renderHook(() => useReaderSettings(repository, now))
    await waitFor(() => {
      expect(result.current.settings).not.toBeNull()
    })

    act(() => {
      result.current.update({ fontSize: 19 })
      result.current.update({ fontSize: 20 })
      result.current.update({ fontSize: 21 })
    })

    expect(requireSettings(result.current.settings).fontSize).toBe(21)
    expect(save).not.toHaveBeenCalled()

    unmount()

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1)
    })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 21 }))
  })

  it('等价的设置重复推送只写一次盘', async () => {
    const now = tickingClock()
    const repository = new InMemorySettingsRepository()
    const save = vi.spyOn(repository, 'save')
    const { result } = renderHook(() => useReaderSettings(repository, now))
    await waitFor(() => {
      expect(result.current.settings).not.toBeNull()
    })

    act(() => {
      result.current.update({})
      result.current.update({})
      result.current.update({})
    })

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1)
    })
  })

  it('卸载时把还没写的设置补上，避免丢最后一次改动', async () => {
    const now = frozenClock()
    const repository = new InMemorySettingsRepository()
    const save = vi.spyOn(repository, 'save')
    const { result, unmount } = renderHook(() => useReaderSettings(repository, now))
    await waitFor(() => {
      expect(result.current.settings).not.toBeNull()
    })

    act(() => result.current.update({ pageMargin: 48 }))
    expect(save).not.toHaveBeenCalled()

    unmount()

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ pageMargin: 48 }))
    })
  })

  it('落盘失败不影响界面上的设置，也不会把错误抛给用户', async () => {
    const now = tickingClock()
    const failing: SettingsRepository = {
      load: () => Promise.resolve(DEFAULT_READER_SETTINGS),
      save: () => Promise.reject(new Error('磁盘满了'))
    }
    const { result, unmount } = renderHook(() => useReaderSettings(failing, now))
    await waitFor(() => {
      expect(result.current.settings).not.toBeNull()
    })

    act(() => result.current.update({ theme: 'sepia' }))

    expect(requireSettings(result.current.settings).theme).toBe('sepia')
    expect(() => unmount()).not.toThrow()
  })

  it('仓库换了实例时会重新读一遍设置', async () => {
    const now = tickingClock()
    const first = new InMemorySettingsRepository({ fontSize: 20 })
    const { result, rerender } = renderHook(
      ({ repository }: { repository: SettingsRepository }) => useReaderSettings(repository, now),
      { initialProps: { repository: first as SettingsRepository } }
    )
    await waitFor(() => {
      expect(result.current.settings).toMatchObject({ fontSize: 20 })
    })

    rerender({ repository: new InMemorySettingsRepository({ fontSize: 28 }) })

    await waitFor(() => {
      expect(result.current.settings).toMatchObject({ fontSize: 28 })
    })
  })
})
