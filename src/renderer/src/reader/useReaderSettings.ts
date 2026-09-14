import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_READER_SETTINGS, normalizeReaderSettings, type ReaderSettings } from '@core/domain/settings'
import type { SettingsRepository } from '@core/ports/settingsRepository'
import { createSettingsWriter, type SettingsWriter } from './settingsWriter'

export interface UseReaderSettingsResult {
  /** 读到之前是 null，调用方据此避免先用默认值渲染一次再重排。 */
  settings: ReaderSettings | null
  update: (patch: Partial<ReaderSettings>) => void
}

/**
 * 阅读设置的读写。
 * 读取失败或还没有保存过时一律回落到默认配置：配置读不出来不该拦住阅读，
 * 越界补丁由 normalizeReaderSettings 夹紧，因此 update 的入参可以来自任何 UI 控件。
 */
export function useReaderSettings(
  repository: SettingsRepository,
  now: () => number = Date.now
): UseReaderSettingsResult {
  const [settings, setSettings] = useState<ReaderSettings | null>(null)
  const current = useRef<ReaderSettings>(DEFAULT_READER_SETTINGS)
  const writerRef = useRef<SettingsWriter | null>(null)

  useEffect(() => {
    let active = true
    const writer = createSettingsWriter({
      save: (value) => repository.save(value),
      now
    })
    writerRef.current = writer

    void repository.load().then(
      (loaded) => {
        if (!active) return
        current.current = loaded
        setSettings(loaded)
      },
      () => {
        if (active) setSettings(DEFAULT_READER_SETTINGS)
      }
    )

    return () => {
      active = false
      writerRef.current = null
      void writer.dispose()
    }
  }, [repository, now])

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    const next = normalizeReaderSettings({ ...current.current, ...patch })
    current.current = next
    setSettings(next)
    writerRef.current?.push(next)
  }, [])

  return { settings, update }
}
