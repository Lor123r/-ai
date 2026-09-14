import type { IpcMain } from 'electron'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { createBook } from '@core/domain/book'
import { createLocator } from '@core/domain/progress'
import { BOOK_CHANNELS } from '@shared/ipc'
import { registerBooksIpc } from '../../../src/main/ipc/booksIpc'
import { describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const NOW = 1_700_000_000_000

function sampleBook(id = 'a') {
  return {
    ...createBook({ id, title: '样书', format: 'epub', filePath: `C:/lib/${id}.epub`, fileSize: 1024 }),
    addedAt: NOW
  }
}

/** 用一个假的 ipcMain 抓住注册的 handler，从而无需启动 Electron 就能测协议层。 */
function setup(): { handlers: Map<string, Handler>; repository: InMemoryBookRepository } {
  const repository = new InMemoryBookRepository()
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    }
  } as unknown as IpcMain

  registerBooksIpc(ipcMain, repository)
  return { handlers, repository }
}

async function call(handlers: Map<string, Handler>, channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`频道未注册：${channel}`)
  // 用 async 包一层，让同步校验抛出的错误也变成 rejected promise（与 ipcMain.handle 行为一致）
  return await handler({}, ...args)
}

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
