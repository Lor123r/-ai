import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import type { BookRepository } from '@core/ports/bookRepository'
import { createBookRepository } from '@renderer/data/createBookRepository'
import { afterEach, describe, expect, it, vi } from 'vitest'

function fakeBridgeRepository(): BookRepository {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    getLocator: vi.fn(async () => null),
    saveLocator: vi.fn(async () => undefined),
    markOpened: vi.fn(async () => undefined)
  }
}

afterEach(() => {
  delete window.api
})

describe('createBookRepository', () => {
  it('没有 preload 桥时回落到内存实现（浏览器预览与单元测试）', () => {
    expect(createBookRepository()).toBeInstanceOf(InMemoryBookRepository)
  })

  it('存在 preload 桥时使用主进程持久化实现', async () => {
    const bridge = fakeBridgeRepository()
    window.api = {
      versions: { node: '24.0.0', chrome: '1', electron: '44' },
      books: bridge,
      library: { pickAndImport: async () => null }
    }

    const repository = createBookRepository()
    expect(repository).toBe(bridge)

    await repository.list()
    expect(bridge.list).toHaveBeenCalledTimes(1)
  })

  it('每次调用都返回可用的仓库', async () => {
    const first = createBookRepository()
    const second = createBookRepository()

    expect(first).not.toBe(second)
    await expect(first.list()).resolves.toEqual([])
  })
})
