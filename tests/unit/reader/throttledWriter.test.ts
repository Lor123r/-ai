import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThrottledWriter } from '@renderer/reader/throttledWriter'

afterEach(() => {
  vi.useRealTimers()
})

function numbersEqual(a: number, b: number): boolean {
  return a === b
}

/** 每次读时间都往前走，用来让「距上次落盘够久」恒成立。 */
function tickingClock(stepMs = 1000): () => number {
  let value = 0
  return () => (value += stepMs)
}

describe('createThrottledWriter', () => {
  it('间隔足够时立刻写，不等最小间隔到期', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 500, now: tickingClock() })

    writer.push(1)
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledWith(1)
    await writer.dispose()
  })

  it('用 equals 判断重复，等价的连续输入只写一次', async () => {
    const save = vi.fn(async () => undefined)
    // 大小写不敏感：'A' 与 'a' 视为同一个值
    const writer = createThrottledWriter({
      save,
      equals: (a, b) => a.toLowerCase() === b.toLowerCase(),
      minIntervalMs: 0,
      now: tickingClock()
    })

    writer.push('a')
    writer.push('A')
    writer.push('a')
    await writer.dispose()

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('间隔内连续输入合并成一次写，写的是最后一个值', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 300, now: () => 0 })

    writer.push(1)
    writer.push(2)
    writer.push(3)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(3)
    await writer.dispose()
  })

  it('待写值与下一个输入等价时不再重复排队', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 300, now: () => 0 })

    writer.push(7)
    writer.push(7)
    writer.push(7)
    await vi.advanceTimersByTimeAsync(300)

    expect(save).toHaveBeenCalledTimes(1)
    await writer.dispose()
  })

  it('间隔足够久时连续输入各写一次，且顺序不乱', async () => {
    const save = vi.fn(async () => undefined)
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 100, now: tickingClock() })

    writer.push(1)
    writer.push(2)
    writer.push(3)
    await writer.dispose()

    expect(save.mock.calls.map(([value]) => value)).toEqual([1, 2, 3])
  })

  it('写操作串成一条链，慢写不会让后写插队', async () => {
    let release: () => void = () => undefined
    const save = vi.fn((value: number) => {
      if (value === 1) return new Promise<void>((resolve) => (release = resolve))
      return Promise.resolve()
    })
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 0, now: tickingClock() })

    writer.push(1)
    writer.push(2)

    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1)
    })

    release()
    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2)
    })
    expect(save.mock.calls[1]![0]).toBe(2)
    await writer.dispose()
  })

  it('dispose 会补上待写值，之后不再接受新值', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => undefined)
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 300, now: () => 0 })

    writer.push(9)
    await writer.dispose()

    expect(save).toHaveBeenCalledWith(9)

    writer.push(10)
    await vi.advanceTimersByTimeAsync(300)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('dispose 在写操作还没完成时会等到写完', async () => {
    let release: () => void = () => undefined
    const save = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 0, now: tickingClock() })

    writer.push(1)
    let settled = false
    const pending = writer.dispose().then(() => {
      settled = true
    })

    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1)
    })
    expect(settled).toBe(false)

    release()
    await pending
    expect(settled).toBe(true)
  })

  it('没有待写内容时 dispose 是空操作', async () => {
    const save = vi.fn(async () => undefined)
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 100, now: tickingClock() })

    await writer.dispose()

    expect(save).not.toHaveBeenCalled()
  })

  it('写失败交给 onError，不会往外抛也不会卡住后续写', async () => {
    const failure = new Error('磁盘满了')
    const onError = vi.fn()
    const save = vi.fn(async (value: number) => {
      if (value === 1) throw failure
    })
    const writer = createThrottledWriter({
      save,
      equals: numbersEqual,
      minIntervalMs: 0,
      now: tickingClock(),
      onError
    })

    writer.push(1)
    writer.push(2)

    await expect(writer.dispose()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledWith(failure)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('没有 onError 时写失败被静默吞掉，调用方仍然能正常 dispose', async () => {
    const writer = createThrottledWriter({
      save: () => Promise.reject(new Error('磁盘满了')),
      equals: numbersEqual,
      minIntervalMs: 0,
      now: tickingClock()
    })

    writer.push(1)

    await expect(writer.dispose()).resolves.toBeUndefined()
  })

  it('一次写失败不会锁死后续写', async () => {
    let shouldFail = true
    const save = vi.fn(async () => {
      if (shouldFail) throw new Error('磁盘满了')
    })
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 0, now: tickingClock() })

    writer.push(1)
    shouldFail = false
    writer.push(2)

    await expect(writer.dispose()).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(1, 1)
    expect(save).toHaveBeenNthCalledWith(2, 2)
  })

  it('默认用 Date.now 计时：真实时间里第一次写立刻发生', async () => {
    const save = vi.fn(async () => undefined)
    const writer = createThrottledWriter({ save, equals: numbersEqual, minIntervalMs: 60_000 })

    writer.push(1)
    await writer.dispose()

    expect(save).toHaveBeenCalledTimes(1)
  })
})
