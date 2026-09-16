import type { IpcMain } from 'electron'
import { createBookmark } from '@core/domain/annotation'
import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { createBook } from '@core/domain/book'
import { createLocator } from '@core/domain/progress'
import { BOOK_CHANNELS } from '@shared/ipc'
import { registerBooksIpc } from '../../../src/main/ipc/booksIpc'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const NOW = 1_700_000_000_000

function sampleBook(id = 'a') {
  return {
    ...createBook({ id, title: '样书', format: 'epub', filePath: `C:/lib/${id}.epub`, fileSize: 1024 }),
    addedAt: NOW
  }
}

function sampleBookmark(bookId: string, id: string) {
  return createBookmark({ id, bookId, cfi: `epubcfi(/6/4!/4/${id.length})`, chapterHref: 'ch1.xhtml' }, NOW)
}

/** 用一个假的 ipcMain 抓住注册的 handler，从而无需启动 Electron 就能测协议层。 */
function setup(): {
  handlers: Map<string, Handler>
  repository: InMemoryBookRepository
  annotations: InMemoryAnnotationRepository
} {
  const repository = new InMemoryBookRepository()
  const annotations = new InMemoryAnnotationRepository()
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    }
  } as unknown as IpcMain

  registerBooksIpc(ipcMain, repository, annotations)
  return { handlers, repository, annotations }
}

async function call(handlers: Map<string, Handler>, channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`频道未注册：${channel}`)
  // 用 async 包一层，让同步校验抛出的错误也变成 rejected promise（与 ipcMain.handle 行为一致）
  return await handler({}, ...args)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerBooksIpc', () => {
  it('注册了全部书库频道', () => {
    const { handlers } = setup()
    expect([...handlers.keys()].sort()).toEqual(Object.values(BOOK_CHANNELS).sort())
  })

  it('list / get 转发到仓库', async () => {
    const { handlers } = setup()
    await call(handlers, BOOK_CHANNELS.save, sampleBook())

    await expect(call(handlers, BOOK_CHANNELS.list)).resolves.toEqual([sampleBook()])
    await expect(call(handlers, BOOK_CHANNELS.get, 'a')).resolves.toEqual(sampleBook())
    await expect(call(handlers, BOOK_CHANNELS.get, 'ghost')).resolves.toBeNull()
  })

  it('来自渲染进程的书籍数据先校验再入库', async () => {
    const { handlers } = setup()

    await expect(call(handlers, BOOK_CHANNELS.save, { id: 'a' })).rejects.toThrow(/不合法/)
    await expect(call(handlers, BOOK_CHANNELS.save, 'not-an-object')).rejects.toThrow(/不合法/)
    await expect(call(handlers, BOOK_CHANNELS.list)).resolves.toEqual([])
  })

  it('书籍的非法字段被归一化，而不是让调用失败', async () => {
    const { handlers } = setup()
    await call(handlers, BOOK_CHANNELS.save, { ...sampleBook(), title: 42 })

    await expect(call(handlers, BOOK_CHANNELS.get, 'a')).resolves.toMatchObject({ title: '未命名书籍' })
  })

  it('书籍 id 必须是合法字符串', async () => {
    const { handlers } = setup()

    await expect(call(handlers, BOOK_CHANNELS.get, '')).rejects.toThrow('书籍 id 不合法')
    await expect(call(handlers, BOOK_CHANNELS.remove, null)).rejects.toThrow('书籍 id 不合法')
    await expect(call(handlers, BOOK_CHANNELS.getLocator, 7)).rejects.toThrow('书籍 id 不合法')
  })

  it('markOpened 校验时间戳', async () => {
    const { handlers } = setup()
    await call(handlers, BOOK_CHANNELS.save, sampleBook())

    await expect(call(handlers, BOOK_CHANNELS.markOpened, 'a', 'now')).rejects.toThrow('时间戳不合法')
    await expect(call(handlers, BOOK_CHANNELS.markOpened, 'a', -1)).rejects.toThrow('时间戳不合法')

    await call(handlers, BOOK_CHANNELS.markOpened, 'a', NOW + 5)
    await expect(call(handlers, BOOK_CHANNELS.get, 'a')).resolves.toMatchObject({ lastOpenedAt: NOW + 5 })
  })

  it('saveLocator 拒绝非法进度，且不会污染已有进度', async () => {
    const { handlers } = setup()
    await call(handlers, BOOK_CHANNELS.save, sampleBook())

    await expect(call(handlers, BOOK_CHANNELS.saveLocator, 'a', 'epubcfi(/6/4)')).rejects.toThrow(
      '阅读进度数据不合法'
    )
    await expect(call(handlers, BOOK_CHANNELS.getLocator, 'a')).resolves.toBeNull()

    const locator = createLocator({ cfi: 'epubcfi(/6/4)', percent: 0.4, chapterIndex: 1 }, NOW)
    await call(handlers, BOOK_CHANNELS.saveLocator, 'a', locator)
    await expect(call(handlers, BOOK_CHANNELS.getLocator, 'a')).resolves.toEqual(locator)
  })

  it('操作不存在的书籍时错误原样传给渲染进程', async () => {
    const { handlers } = setup()

    await expect(call(handlers, BOOK_CHANNELS.saveLocator, 'ghost', createLocator({}, NOW))).rejects.toThrow(/ghost/)
    await expect(call(handlers, BOOK_CHANNELS.markOpened, 'ghost', NOW)).rejects.toThrow(/ghost/)
    await expect(call(handlers, BOOK_CHANNELS.remove, 'ghost')).resolves.toBeUndefined()
  })

  it('仓库抛错时调用以 reject 结束，而不是返回半个结果', async () => {
    const { handlers, repository } = setup()
    vi.spyOn(repository, 'list').mockRejectedValueOnce(new Error('磁盘炸了'))

    await expect(call(handlers, BOOK_CHANNELS.list)).rejects.toThrow('磁盘炸了')
  })
})

describe('删书时清理该书的注解', () => {
  it('先删书、后清注解', async () => {
    const { handlers, repository, annotations } = setup()
    const calls: string[] = []
    const removeBook = repository.remove.bind(repository)
    const removeByBook = annotations.removeByBook.bind(annotations)
    vi.spyOn(repository, 'remove').mockImplementation(async (id: string) => {
      calls.push(`book:${id}`)
      await removeBook(id)
    })
    vi.spyOn(annotations, 'removeByBook').mockImplementation(async (id: string) => {
      calls.push(`annotations:${id}`)
      return await removeByBook(id)
    })

    await call(handlers, BOOK_CHANNELS.save, sampleBook())
    await call(handlers, BOOK_CHANNELS.remove, 'a')

    // 顺序本身就是不变量：反序时删书失败会留下「书还在、划线没了」
    expect(calls).toEqual(['book:a', 'annotations:a'])
    await expect(call(handlers, BOOK_CHANNELS.list)).resolves.toEqual([])
  })

  it('只清这本书的注解，别的书一条不动', async () => {
    const { handlers, annotations } = setup()
    await annotations.save(sampleBookmark('a', 'a1'))
    await annotations.save(sampleBookmark('b', 'b1'))

    await call(handlers, BOOK_CHANNELS.remove, 'a')

    await expect(annotations.listByBook('a')).resolves.toEqual([])
    await expect(annotations.listByBook('b')).resolves.toEqual([sampleBookmark('b', 'b1')])
  })

  it('注解清不掉时删书仍然算成功，只在控制台留痕', async () => {
    const { handlers, annotations } = setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await call(handlers, BOOK_CHANNELS.save, sampleBook())
    // 降级启动时注解仓储就是这个行为
    vi.spyOn(annotations, 'removeByBook').mockRejectedValueOnce(new Error('注解存档本次会话不可用'))

    await expect(call(handlers, BOOK_CHANNELS.remove, 'a')).resolves.toBeUndefined()
    await expect(call(handlers, BOOK_CHANNELS.list)).resolves.toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('注解没能一并清掉'))
  })

  it('删一本已经不在书库里的书也会清注解，把孤儿注解带走', async () => {
    const { handlers, annotations } = setup()
    await annotations.save(sampleBookmark('ghost', 'g1'))

    await expect(call(handlers, BOOK_CHANNELS.remove, 'ghost')).resolves.toBeUndefined()
    await expect(annotations.listByBook('ghost')).resolves.toEqual([])
  })

  it('书籍 id 非法时一条数据也不碰', async () => {
    const { handlers, repository, annotations } = setup()
    const removeBook = vi.spyOn(repository, 'remove')
    const removeByBook = vi.spyOn(annotations, 'removeByBook')

    await expect(call(handlers, BOOK_CHANNELS.remove, '   ')).rejects.toThrow('书籍 id 不合法')
    expect(removeBook).not.toHaveBeenCalled()
    expect(removeByBook).not.toHaveBeenCalled()
  })
})
