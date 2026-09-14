export interface ThrottledWriterOptions<T> {
  save: (value: T) => Promise<void>
  /** 判断是否与上次写入的值等价，等价就不重复写。 */
  equals: (a: T, b: T) => boolean
  minIntervalMs: number
  now?: () => number
  /** 写失败不该打断用户操作，交给上层决定怎么提示。 */
  onError?: (error: unknown) => void
}

export interface ThrottledWriter<T> {
  /** 记录最新值：与上次写入等价则忽略，间隔太近则延后合并成一次写。 */
  push(value: T): void
  /** 把还没写入的值补上，之后不再接受新值。 */
  dispose(): Promise<void>
}

/**
 * 节流落盘器。
 * 用户操作密集时（翻页、连点字号加减）每次变化都写一次盘既浪费又没必要，
 * 所以按「值去重 + 最小间隔」合并，并把写操作串成一条链，
 * 避免慢的写覆盖掉后写的内容。
 */
export function createThrottledWriter<T>(options: ThrottledWriterOptions<T>): ThrottledWriter<T> {
  const now = options.now ?? Date.now
  let lastSaved: T | null = null
  let lastSavedAt = 0
  let pending: T | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let chain: Promise<void> = Promise.resolve()

  function isRedundant(value: T): boolean {
    return lastSaved !== null && options.equals(value, lastSaved)
  }

  function write(value: T): void {
    lastSaved = value
    lastSavedAt = now()
    chain = chain
      .then(() => options.save(value))
      .catch((error: unknown) => {
        options.onError?.(error)
      })
  }

  function clearTimer(): void {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  function push(value: T): void {
    if (stopped) return
    if (isRedundant(value)) return
    if (pending !== null && options.equals(value, pending)) return

    // 已经排了一次待写，后来的值直接顶替它，不必再排一次
    if (timer !== null) {
      pending = value
      return
    }

    const elapsed = now() - lastSavedAt
    if (elapsed >= options.minIntervalMs) {
      write(value)
      return
    }

    pending = value
    timer = setTimeout(() => {
      timer = null
      const queued = pending
      pending = null
      if (queued !== null) write(queued)
    }, options.minIntervalMs - elapsed)
  }

  async function dispose(): Promise<void> {
    stopped = true
    clearTimer()

    const queued = pending
    pending = null
    if (queued !== null && !isRedundant(queued)) write(queued)

    await chain
  }

  return { push, dispose }
}
