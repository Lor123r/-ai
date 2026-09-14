import { isSameLocation, type ReadingLocator } from '@core/domain/progress'
import { createThrottledWriter } from './throttledWriter'

/** 两次落盘之间的最小间隔，翻页很快时把中间的进度合并掉。 */
export const LOCATOR_SAVE_INTERVAL_MS = 500

export interface LocatorWriterOptions {
  save: (locator: ReadingLocator) => Promise<void>
  minIntervalMs?: number
  now?: () => number
  /** 落盘失败不该打断阅读，交给上层决定怎么提示。 */
  onError?: (error: unknown) => void
}

export interface LocatorWriter {
  /** 记录最新位置：同一位置不重复写，间隔太近则延后合并成一次写。 */
  push(locator: ReadingLocator): void
  /** 把还没落盘的进度补上，之后不再接受新的位置。 */
  dispose(): Promise<void>
}

/** 阅读进度的落盘节流器，节流语义见 createThrottledWriter。 */
export function createLocatorWriter(options: LocatorWriterOptions): LocatorWriter {
  return createThrottledWriter({
    save: options.save,
    equals: isSameLocation,
    minIntervalMs: options.minIntervalMs ?? LOCATOR_SAVE_INTERVAL_MS,
    now: options.now,
    onError: options.onError
  })
}
