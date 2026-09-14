import { isSameLocation, type ReadingLocator } from '@core/domain/progress'

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

/**
 * 阅读进度的落盘节流器。
 * 每次翻页都写一次盘既浪费又没必要，所以按「位置去重 + 最小间隔」合并，
 * 并且把写操作串成一条链，避免慢的写覆盖掉后写的进度。
 */
export function createLocatorWriter(options: LocatorWriterOptions): LocatorWriter {
  const minInterval = options.minIntervalMs ?? LOCATOR_SAVE_INTERVAL_MS
  const now = options.now ?? Date.now
  let lastSaved: ReadingLocator | null = null
  let lastSavedAt = 0
  let pending: ReadingLocator | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let chain: Promise<void> = Promise.resolve()

  function write(locator: ReadingLocator): void {
    lastSaved = locator
    lastSavedAt = now()
    chain = chain
      .then(() => options.save(locator))
      .catch((error: unknown) => {
        options.onError?.(error)
      })
  }

  function clearTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function push(locator: ReadingLocator): void {
    if (stopped) return
    if (isSameLocation(locator, pending ?? lastSaved)) return

    // 已经排了一次待写，后来的位置直接顶替它，不必再排一次
    if (timer !== null) {
      pending = locator
      return
    }

    const elapsed = now() - lastSavedAt
    if (elapsed >= minInterval) {
      write(locator)
      return
    }

    pending = locator
    timer = setTimeout(() => {
      timer = null
      const queued = pending
      pending = null
      if (queued) write(queued)
    }, minInterval - elapsed)
  }

  async function dispose(): Promise<void> {
    stopped = true
    clearTimer()

    const queued = pending
    pending = null
    if (queued && !isSameLocation(queued, lastSaved)) write(queued)

    await chain
  }

  return { push, dispose }
}
