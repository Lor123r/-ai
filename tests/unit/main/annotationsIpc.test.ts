import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import { createBookmark, createHighlight, type Annotation } from '@core/domain/annotation'
import { ANNOTATION_CHANNELS } from '@shared/ipc'
import { registerAnnotationsIpc } from '../../../src/main/ipc/annotationsIpc'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const NOW = 1_700_000_000_000

function bookmark(id = 'a1', bookId = 'b1'): Annotation {
  return createBookmark({ id, bookId, cfi: 'epubcfi(/6/4!/4/2/2)', note: '笔记' }, NOW)
}

/** 用假 ipcMain 抓住注册的 handler，无需启动 Electron 就能测协议层。 */
function setup(): { handlers: Map<string, Handler>; repository: InMemoryAnnotationRepository } {
  const repository = new InMemoryAnnotationRepository()
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    }
  } as unknown as IpcMain

  registerAnnotationsIpc(ipcMain, repository)
  return { handlers, repository }
}

async function call(
  handlers: Map<string, Handler>,
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`频道未注册：${channel}`)
  return await handler({}, ...args)
}

describe('registerAnnotationsIpc', () => {
  it('注册了全部注解频道', () => {
    const { handlers } = setup()

    expect([...handlers.keys()].sort()).toEqual(Object.values(ANNOTATION_CHANNELS).sort())
  })

  it('空存档时 list 返回空数组', async () => {
    const { handlers } = setup()

    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b1')).resolves.toEqual([])
  })

  it('save 之后 list 能读回同一条注解', async () => {
    const { handlers } = setup()

    await call(handlers, ANNOTATION_CHANNELS.save, bookmark())
    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b1')).resolves.toEqual([bookmark()])
  })

  it('list 只返回该书的注解', async () => {
    const { handlers } = setup()

    await call(handlers, ANNOTATION_CHANNELS.save, bookmark('a1', 'b1'))
    await call(handlers, ANNOTATION_CHANNELS.save, bookmark('a2', 'b2'))

    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b1')).resolves.toEqual([bookmark('a1', 'b1')])
  })

  it('save 收到非对象时抛错，而不是写入一条空注解', async () => {
    const { handlers, repository } = setup()

    await expect(call(handlers, ANNOTATION_CHANNELS.save, null)).rejects.toThrow('注解数据不合法')
    await expect(repository.listByBook('b1')).resolves.toEqual([])
  })

  it('save 收到核心字段非法的数据时抛错', async () => {
    const { handlers } = setup()
    const broken = { id: 'a1', bookId: 'b1', kind: 'bookmark' }

    await expect(call(handlers, ANNOTATION_CHANNELS.save, broken)).rejects.toThrow('注解数据不合法')
  })

  it('save 拒绝含非法字符的 id', async () => {
    const { handlers } = setup()

    await expect(
      call(handlers, ANNOTATION_CHANNELS.save, { ...bookmark(), id: '../etc/passwd' })
    ).rejects.toThrow('注解数据不合法')
  })

  it('save 逐字段收敛：trim id、清洗笔记、丢掉未知字段', async () => {
    const { handlers } = setup()

    await call(handlers, ANNOTATION_CHANNELS.save, {
      ...bookmark(),
      id: '  a1  ',
      note: '  换行\n\t的笔记  ',
      injected: '不该落盘'
    })

    const list = (await call(handlers, ANNOTATION_CHANNELS.list, 'b1')) as Annotation[]
    expect(list).toEqual([{ ...bookmark(), note: '换行 的笔记' }])
    expect(list[0]).not.toHaveProperty('injected')
  })

  it('save 缺失 createdAt 时用当前时间补齐', async () => {
    const { handlers } = setup()

    await call(handlers, ANNOTATION_CHANNELS.save, {
      id: 'a1',
      bookId: 'b1',
      kind: 'bookmark',
      cfi: 'epubcfi(/6/4!/4/2/2)',
      note: '笔记'
    })

    const list = (await call(handlers, ANNOTATION_CHANNELS.list, 'b1')) as Annotation[]
    expect(list).toHaveLength(1)
    expect(list[0]!.createdAt).toBeGreaterThan(0)
    expect(list[0]!.updatedAt).toBe(list[0]!.createdAt)
    expect(list[0]!.note).toBe('笔记')
  })

  it('save 同一条重放两次只留一条（渲染层乐观更新可能重放 IPC）', async () => {
    const { handlers } = setup()

    await call(handlers, ANNOTATION_CHANNELS.save, bookmark())
    await call(handlers, ANNOTATION_CHANNELS.save, bookmark())

    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b1')).resolves.toHaveLength(1)
  })

  it('list 收到非法 bookId 时抛错', async () => {
    const { handlers } = setup()

    await expect(call(handlers, ANNOTATION_CHANNELS.list, '')).rejects.toThrow('注解所属书籍 id 不合法')
    await expect(call(handlers, ANNOTATION_CHANNELS.list, 42)).rejects.toThrow('注解所属书籍 id 不合法')
    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b'.repeat(200))).rejects.toThrow(
      '注解所属书籍 id 不合法'
    )
  })

  it('remove 删掉指定注解', async () => {
    const { handlers } = setup()
    await call(handlers, ANNOTATION_CHANNELS.save, bookmark('a1'))
    await call(handlers, ANNOTATION_CHANNELS.save, bookmark('a2'))

    await call(handlers, ANNOTATION_CHANNELS.remove, 'b1', 'a1')

    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b1')).resolves.toEqual([bookmark('a2')])
  })

  it('remove 对不存在的 id 静默成功（幂等）', async () => {
    const { handlers } = setup()

    await expect(call(handlers, ANNOTATION_CHANNELS.remove, 'b1', 'ghost')).resolves.toBeUndefined()
  })

  it('remove 收到非法 id 时抛错，不会误删', async () => {
    const { handlers } = setup()
    await call(handlers, ANNOTATION_CHANNELS.save, bookmark('a1'))

    await expect(call(handlers, ANNOTATION_CHANNELS.remove, 'b1', '')).rejects.toThrow('注解 id 不合法')
    await expect(call(handlers, ANNOTATION_CHANNELS.remove, 'b1', 'a b')).rejects.toThrow(
      '注解 id 不合法'
    )
    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b1')).resolves.toEqual([bookmark('a1')])
  })

  it('remove 的 id 先 trim 再匹配，带空格的 id 能删掉原名条目', async () => {
    const { handlers } = setup()
    await call(handlers, ANNOTATION_CHANNELS.save, bookmark('a1'))

    await call(handlers, ANNOTATION_CHANNELS.remove, 'b1', '  a1  ')

    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b1')).resolves.toEqual([])
  })

  it('remove 的 bookId 会被 trim 后使用', async () => {
    const { handlers } = setup()
    await call(handlers, ANNOTATION_CHANNELS.save, bookmark('a1', 'b1'))

    await call(handlers, ANNOTATION_CHANNELS.remove, '  b1  ', 'a1')

    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b1')).resolves.toEqual([])
  })

  it('划线的 excerpt 与配色会被规范化后保存', async () => {
    const { handlers } = setup()
    const raw = { ...createHighlight({ id: 'h1', bookId: 'b1', cfi: 'epubcfi(/6/4!/4/2/2)' }, NOW), color: 'neon' }

    await call(handlers, ANNOTATION_CHANNELS.save, raw)

    const list = (await call(handlers, ANNOTATION_CHANNELS.list, 'b1')) as Annotation[]
    expect(list[0]).toMatchObject({ kind: 'highlight', color: 'yellow', excerpt: '' })
  })

  it('仓库抛错时调用以 reject 结束', async () => {
    const { handlers, repository } = setup()
    vi.spyOn(repository, 'listByBook').mockRejectedValueOnce(new Error('存档炸了'))

    await expect(call(handlers, ANNOTATION_CHANNELS.list, 'b1')).rejects.toThrow('存档炸了')
  })

  it('save 失败时错误向上抛出，渲染进程可以决定是否回滚乐观更新', async () => {
    const { handlers, repository } = setup()
    vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('磁盘已满'))

    await expect(call(handlers, ANNOTATION_CHANNELS.save, bookmark())).rejects.toThrow('磁盘已满')
  })
})
