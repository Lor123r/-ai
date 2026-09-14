import { readerSettingsEqual, type ReaderSettings } from '@core/domain/settings'
import { createThrottledWriter, type ThrottledWriter } from './throttledWriter'

/** 设置变更远不如翻页频繁，稍短的间隔即可，改完很快就能看到「已保存」。 */
export const SETTINGS_SAVE_INTERVAL_MS = 250

export interface SettingsWriterOptions {
  save: (settings: ReaderSettings) => Promise<void>
  minIntervalMs?: number
  now?: () => number
  onError?: (error: unknown) => void
}

export type SettingsWriter = ThrottledWriter<ReaderSettings>

export function createSettingsWriter(options: SettingsWriterOptions): SettingsWriter {
  return createThrottledWriter({
    save: options.save,
    equals: readerSettingsEqual,
    minIntervalMs: options.minIntervalMs ?? SETTINGS_SAVE_INTERVAL_MS,
    now: options.now,
    onError: options.onError
  })
}
