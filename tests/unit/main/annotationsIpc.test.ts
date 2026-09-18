import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, Dialog, IpcMain, SaveDialogOptions } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAnnotationTransfer, serializeAnnotationTransfer } from '@core/adapters/annotationTransfer'
import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { createBook, type Book } from '@core/domain/book'
import { createBookmark, createHighlight, type Annotation } from '@core/domain/annotation'
import {
  ANNOTATION_CHANNELS,
  ANNOTATION_EXPORT_BOUNDARY_MESSAGE,
  ANNOTATION_FILE_INVALID_MESSAGE,
  ANNOTATION_TRANSFER_CHANNELS
} from '@shared/ipc'
import { registerAnnotationsIpc } from '../../../src/main/ipc/annotationsIpc'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const NOW = 1_700_000_000_000
const DEFAULT_DIRECTORY = 'C:/Users/reader/Documents'
const DEFAULT_USER_DATA = 'C:/Users/reader/AppData/Roaming/reader'

function sampleBook(id = 'b1', title = '三体'): Book {
  return createBook({ id, title, format: 'epub', filePath: `C:/lib/${id}.epub`, fileSize: 1024 }, NOW)
}

function bookmark(id = 'a1', bookId = 'b1'): Annotation {
  return createBookmark({ id, bookId, cfi: 'epubcfi(/6/4!/4/2/2)', note: '笔记' }, NOW)
}

/** 造一份交换文件的内容，信封里的书 id 与条目自带的可以不同（导入要以信封为准）。 */
function transferText(bookId: string, annotations: readonly Annotation[], title = '另一本'): string {
  return serializeAnnotationTransfer({ id: bookId, title }, annotations, NOW)
}

/** 每个用例自己开的临时目录，用完统一删掉，避免把文件残留到真实磁盘上。 */
const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'reader-annotation-ipc-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

interface SetupOptions {
  /** 书架上的书；null 表示书架上没有这本书。 */
  book?: Book | null
  /** 另存框返回的路径；null 表示用户取消。 */
  savePath?: string | null
  /** 打开框返回的路径；null 表示用户取消。 */
  openPath?: string | null
  userDataDir?: string
  defaultDirectory?: string
  /** 默认没有窗口（非模态框），传值可验证窗口被转发给了对话框。 */
  window?: BrowserWindow | null
}

interface SetupResult {
  handlers: Map<string, Handler>
  repository: InMemoryAnnotationRepository
  saveDialog: ReturnType<typeof vi.fn>
  openDialog: ReturnType<typeof vi.fn>
}

/** 用假 ipcMain 抓住注册的 handler，无需启动 Electron 就能测协议层。 */
function setup(options: SetupOptions = {}): SetupResult {
  const repository = new InMemoryAnnotationRepository()
  const books = new InMemoryBookRepository()
  const shelfBook = options.book === undefined ? sampleBook() : options.book
  // 内存仓储的 save 在第一个 await 之前就把书写进去了，同步 void 掉即可
  if (shelfBook) void books.save(shelfBook)

  const saveDialog = vi.fn(async () =>
    options.savePath ? { canceled: false, filePath: options.savePath } : { canceled: true, filePath: '' }
  )
  const openDialog = vi.fn(async () =>
    options.openPath ? { canceled: false, filePaths: [options.openPath] } : { canceled: true, filePaths: [] }
  )

  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    }
  } as unknown as IpcMain

  registerAnnotationsIpc(ipcMain, {
    annotations: repository,
    books,
    dialog: { showSaveDialog: saveDialog, showOpenDialog: openDialog } as unknown as Dialog,
    getWindow: () => options.window ?? null,
    defaultDirectory: options.defaultDirectory ?? DEFAULT_DIRECTORY,
    userDataDir: options.userDataDir ?? DEFAULT_USER_DATA,
    now: () => NOW
  })

  return { handlers, repository, saveDialog, openDialog }
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

    // 交换用的两个频道注册在同一个函数里，所以这里是两组的并集
    expect([...handlers.keys()].sort()).toEqual(
      [...Object.values(ANNOTATION_CHANNELS), ...Object.values(ANNOTATION_TRANSFER_CHANNELS)].sort()
    )
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

  describe('导出', () => {
    it('写出交换文件，条目与信封都对得上', async () => {
      const dir = await makeTempDir()
      const target = join(dir, '三体-注解.json')
      const { handlers, repository } = setup({ savePath: target })
      await repository.save(bookmark('a1'))
      await repository.save(bookmark('a2'))

      const summary = await call(handlers, ANNOTATION_TRANSFER_CHANNELS.exportBook, 'b1')

      expect(summary).toEqual({ count: 2 })
      const parsed = parseAnnotationTransfer(await readFile(target, 'utf8'), NOW)
      expect(parsed.book).toEqual({ id: 'b1', title: '三体' })
      expect(parsed.annotations.map((annotation) => annotation.id).sort()).toEqual(['a1', 'a2'])
    })

    it('空列表也能导出，得到一份合法但为空的文件', async () => {
      const dir = await makeTempDir()
      const target = join(dir, 'empty.json')
      const { handlers } = setup({ savePath: target })

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.exportBook, 'b1')).resolves.toEqual({
        count: 0
      })
      expect(parseAnnotationTransfer(await readFile(target, 'utf8'), NOW).annotations).toEqual([])
    })

    it('用户取消另存框时返回 null，不写任何文件', async () => {
      const dir = await makeTempDir()
      const { handlers, repository } = setup({ savePath: null })
      await repository.save(bookmark('a1'))

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.exportBook, 'b1')).resolves.toBeNull()
      await expect(readdir(dir)).resolves.toEqual([])
    })

    it('默认文件名按书名 sanitize，并落在注入的起始目录里', async () => {
      const { handlers, saveDialog } = setup({
        savePath: null,
        book: sampleBook('b1', '三体/全集: 第一部?')
      })

      await call(handlers, ANNOTATION_TRANSFER_CHANNELS.exportBook, 'b1')

      const options = saveDialog.mock.calls[0]![0] as SaveDialogOptions
      expect(options.defaultPath).toBe(join(DEFAULT_DIRECTORY, '三体 全集 第一部-注解.json'))
    })

    it('没有窗口时用非模态框，有窗口时把窗口一起传下去', async () => {
      const window = { id: 1 } as unknown as BrowserWindow
      const { handlers, saveDialog } = setup({ savePath: null, window })

      await call(handlers, ANNOTATION_TRANSFER_CHANNELS.exportBook, 'b1')

      expect(saveDialog.mock.calls[0]![0]).toBe(window)
    })

    it('目标落在应用数据目录里时拒绝，且不留下任何文件', async () => {
      const userDataDir = await makeTempDir()
      const target = join(userDataDir, 'annotations.json')
      const { handlers, repository } = setup({ savePath: target, userDataDir })
      await repository.save(bookmark('a1'))

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.exportBook, 'b1')).rejects.toThrow(
        ANNOTATION_EXPORT_BOUNDARY_MESSAGE
      )
      // 连临时文件也不能剩：写了一半再删掉才失败，说明边界校验晚了一步
      await expect(readdir(userDataDir)).resolves.toEqual([])
    })

    it('写盘失败时清掉临时文件', async () => {
      const dir = await makeTempDir()
      const occupied = join(dir, 'occupied')
      // 目标是个非空目录，rename 必定失败；此时已写好的临时文件必须被删掉
      await mkdir(occupied)
      await writeFile(join(occupied, 'keep.txt'), 'x')
      const { handlers, repository } = setup({ savePath: occupied })
      await repository.save(bookmark('a1'))

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.exportBook, 'b1')).rejects.toThrow()
      await expect(readdir(dir)).resolves.toEqual(['occupied'])
    })

    it('书架上没有这本书时拒绝，且不弹另存框', async () => {
      const { handlers, saveDialog } = setup({ book: null, savePath: 'C:/tmp/x.json' })

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.exportBook, 'b1')).rejects.toThrow(
        '书籍不存在'
      )
      expect(saveDialog).not.toHaveBeenCalled()
    })
  })

  describe('导入', () => {
    it('把文件里的注解写进目标书，并上报计数', async () => {
      const dir = await makeTempDir()
      const source = join(dir, 'in.json')
      await writeFile(source, transferText('b-other', [bookmark('a1', 'b-other'), bookmark('a2', 'b-other')]))
      const { handlers } = setup({ openPath: source })

      const summary = await call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')

      expect(summary).toEqual({ added: 2, skipped: 0, dropped: 0, trimmed: 0, fromOtherBook: true })
    })

    it('文件里的 bookId 一律重定向到目标书', async () => {
      const dir = await makeTempDir()
      const source = join(dir, 'in.json')
      await writeFile(source, transferText('b-other', [bookmark('a1', 'b-other')]))
      const { handlers, repository } = setup({ openPath: source })

      await call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')

      const list = await repository.listByBook('b1')
      expect(list.map((annotation) => annotation.bookId)).toEqual(['b1'])
    })

    it('导出自同一本书时不加那句提醒', async () => {
      const dir = await makeTempDir()
      const source = join(dir, 'in.json')
      await writeFile(source, transferText('b1', [bookmark('a1')]))
      const { handlers } = setup({ openPath: source })

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')).resolves.toMatchObject({
        added: 1,
        fromOtherBook: false
      })
    })

    it('同一份文件再导入一次只新增 0 条（幂等）', async () => {
      const dir = await makeTempDir()
      const source = join(dir, 'in.json')
      await writeFile(source, transferText('b-other', [bookmark('a1'), bookmark('a2')]))
      const { handlers, repository } = setup({ openPath: source })

      await call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')
      const second = await call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')

      expect(second).toEqual({ added: 0, skipped: 2, dropped: 0, trimmed: 0, fromOtherBook: true })
      await expect(repository.listByBook('b1')).resolves.toHaveLength(2)
    })

    it('文件不是合法 JSON 时抛固定文案，且不碰存档', async () => {
      const dir = await makeTempDir()
      const source = join(dir, 'in.json')
      await writeFile(source, '这不是 json')
      const { handlers, repository } = setup({ openPath: source })

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')).rejects.toThrow(
        ANNOTATION_FILE_INVALID_MESSAGE
      )
      await expect(repository.listByBook('b1')).resolves.toEqual([])
    })

    it('把全库存档当成交换文件时被 kind 挡住', async () => {
      const dir = await makeTempDir()
      const source = join(dir, 'annotations.json')
      // 全库存档的形状几乎是本格式的超集，靠 kind 才能区分
      await writeFile(source, JSON.stringify({ version: 1, annotations: [bookmark('a1')] }))
      const { handlers, repository } = setup({ openPath: source })

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')).rejects.toThrow(
        ANNOTATION_FILE_INVALID_MESSAGE
      )
      await expect(repository.listByBook('b1')).resolves.toEqual([])
    })

    it('格式版本不匹配时整份拒绝，不做尽力而为', async () => {
      const dir = await makeTempDir()
      const source = join(dir, 'in.json')
      await writeFile(
        source,
        JSON.stringify({
          kind: 'ebook-reader-annotations',
          version: 99,
          book: { id: 'b-other', title: '' },
          annotations: [bookmark('a1')]
        })
      )
      const { handlers, repository } = setup({ openPath: source })

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')).rejects.toThrow(
        ANNOTATION_FILE_INVALID_MESSAGE
      )
      await expect(repository.listByBook('b1')).resolves.toEqual([])
    })

    it('单条记录坏掉时仍然导入其余条目并计入 dropped', async () => {
      const dir = await makeTempDir()
      const source = join(dir, 'in.json')
      const raw = JSON.parse(transferText('b-other', [bookmark('a1')])) as {
        annotations: unknown[]
      }
      raw.annotations.push({ id: '', kind: 'bookmark' })
      await writeFile(source, JSON.stringify(raw))
      const { handlers } = setup({ openPath: source })

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')).resolves.toMatchObject({
        added: 1,
        dropped: 1
      })
    })

    it('用户取消打开框时返回 null', async () => {
      const { handlers, repository } = setup({ openPath: null })

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')).resolves.toBeNull()
      await expect(repository.listByBook('b1')).resolves.toEqual([])
    })

    it('书架上没有这本书时拒绝，且不弹打开框', async () => {
      const { handlers, openDialog } = setup({ book: null, openPath: 'C:/tmp/x.json' })

      await expect(call(handlers, ANNOTATION_TRANSFER_CHANNELS.importInto, 'b1')).rejects.toThrow(
        '书籍不存在'
      )
      expect(openDialog).not.toHaveBeenCalled()
    })
  })
})
