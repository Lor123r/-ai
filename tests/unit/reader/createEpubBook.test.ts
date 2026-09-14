import { beforeEach, describe, expect, it, vi } from 'vitest'

const ePub = vi.fn((buffer: ArrayBuffer) => ({ buffer, ready: Promise.resolve(), renderTo: vi.fn(), destroy: vi.fn() }))

vi.mock('epubjs', () => ({ default: (buffer: ArrayBuffer) => ePub(buffer) }))

const { createEpubBook } = await import('@renderer/reader/createEpubBook')

beforeEach(() => {
  ePub.mockClear()
})

describe('createEpubBook', () => {
  it('把字节交给 epub.js，并传入独立的 ArrayBuffer', () => {
    const bytes = new TextEncoder().encode('伪装的 EPUB 内容')

    createEpubBook(bytes)

    expect(ePub).toHaveBeenCalledTimes(1)
    const buffer = ePub.mock.calls[0]![0]
    expect(buffer).toBeInstanceOf(ArrayBuffer)
    // jsdom 的 TextEncoder 返回的 Uint8Array 与断言里的不同源，逐个字节比更稳
    expect(Array.from(new Uint8Array(buffer))).toEqual(Array.from(bytes))
  })

  it('只取视图覆盖的那一段，不会把整个底层缓冲都传过去', () => {
    const full = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const view = full.subarray(2, 5)

    createEpubBook(view)

    expect(new Uint8Array(ePub.mock.calls[0]![0])).toEqual(new Uint8Array([3, 4, 5]))
  })

  it('传入的缓冲是副本，之后改动原数组不影响 epub.js 拿到的数据', () => {
    const bytes = new Uint8Array([9, 9])
    createEpubBook(bytes)

    bytes[0] = 0

    expect(new Uint8Array(ePub.mock.calls[0]![0])).toEqual(new Uint8Array([9, 9]))
  })
})
