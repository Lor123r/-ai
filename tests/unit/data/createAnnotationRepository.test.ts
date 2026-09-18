import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import { createBookmark } from '@core/domain/annotation'
import { createAnnotationRepository } from '@renderer/data/createAnnotationRepository'
import { createFakeBridge } from '../support/fakeBridge'
import { afterEach, describe, expect, it, vi } from 'vitest'

const NOW = 1_700_000_000_000

function bookmark(id = 'a1') {
  return createBookmark({ id, bookId: 'b1', cfi: 'epubcfi(/6/4!/4/2/2)' }, NOW)
}

afterEach(() => {
  delete window.api
})

describe('createAnnotationRepository', () => {
  it('没有 preload 桥时回落到内存实现（浏览器预览与单元测试）', async () => {
    const repository = createAnnotationRepository()

    expect(repository).toBeInstanceOf(InMemoryAnnotationRepository)
    await expect(repository.listByBook('b1')).resolves.toEqual([])
  })

  it('存在 preload 桥时三个方法都转成 IPC 调用', async () => {
    const bridge = {
      listByBook: vi.fn(async () => [bookmark()]),
      save: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    }
    window.api = { ...createFakeBridge(), annotations: bridge }

    const repository = createAnnotationRepository()
    await repository.listByBook('b1')
    await repository.save(bookmark())
    await repository.remove('b1', 'a1')

    expect(bridge.listByBook).toHaveBeenCalledWith('b1')
    expect(bridge.save).toHaveBeenCalledWith(bookmark())
    expect(bridge.remove).toHaveBeenCalledWith('b1', 'a1')
  })

  it('load 是空操作：主进程启动时已经预读过存档', async () => {
    const bridge = {
      listByBook: vi.fn(async () => []),
      save: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    }
    window.api = { ...createFakeBridge(), annotations: bridge }

    await createAnnotationRepository().load()

    expect(bridge.listByBook).not.toHaveBeenCalled()
    expect(bridge.save).not.toHaveBeenCalled()
    expect(bridge.remove).not.toHaveBeenCalled()
  })

  it('removeByBook 直接拒绝：删书清理只能由主进程按「先删书、后删注解」的顺序做', async () => {
    window.api = createFakeBridge()

    await expect(createAnnotationRepository().removeByBook('b1')).rejects.toThrow('只能由主进程执行')
  })

  it('saveMany 直接拒绝：批量写入只在主进程的导入流程里做', async () => {
    window.api = createFakeBridge()

    await expect(createAnnotationRepository().saveMany([bookmark()])).rejects.toThrow('只能由主进程执行')
  })

  it('每次调用都返回可用的仓库', async () => {
    const first = createAnnotationRepository()
    const second = createAnnotationRepository()

    expect(first).not.toBe(second)
    await first.save(bookmark())
    await expect(first.listByBook('b1')).resolves.toEqual([bookmark()])
    await expect(second.listByBook('b1')).resolves.toEqual([])
  })
})
