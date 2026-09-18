import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { UNTITLED_BOOK_TITLE } from '@core/domain/book'
import {
  importBooks,
  IMPORT_FAILED_REASON,
  UNREADABLE_EPUB_REASON,
  UNSUPPORTED_FORMAT_REASON
} from '@core/services/importBooks'
import { buildEpubBytes } from '../../../support/epubFixture'
import { FakeFileStore } from '../../support/fakeFileStore'

const NOW = 1_700_000_000_000

async function setup(epubOptions: Parameters<typeof buildEpubBytes>[0] = {}) {
  const fileStore = new FakeFileStore()
  fileStore.addSource('C:/下载/三体.epub', await buildEpubBytes(epubOptions))

  return { fileStore, repository: new InMemoryBookRepository(), now: () => NOW }
}

describe('importBooks', () => {
  it('导入 EPUB 后用元数据建书，id 取内容摘要', async () => {
    const deps = await setup({ title: '三体', author: '刘慈欣', identifier: 'urn:uuid:1', spineItems: 4 })

    const report = await importBooks(['C:/下载/三体.epub'], deps)

    expect(report.failed).toEqual([])
    expect(report.skipped).toEqual([])
    expect(report.added).toHaveLength(1)

    const [book] = report.added
    expect(book).toMatchObject({
      title: '三体',
      author: '刘慈欣',
      format: 'epub',
      addedAt: NOW,
      lastOpenedAt: null
    })
    expect(book?.id).toMatch(/^[0-9a-f]{64}$/)
    await expect(deps.repository.list()).resolves.toEqual([book])
  })

  it('抽取封面并记录封面路径，供书架显示', async () => {
    const deps = await setup()

    const report = await importBooks(['C:/下载/三体.epub'], deps)

    expect(deps.fileStore.covers).toHaveLength(1)
    expect(report.added[0]?.coverPath).toBe(deps.fileStore.covers[0]?.path)
  })

  it('没有封面时 coverPath 为 null', async () => {
    const deps = await setup({ coverStyle: 'none' })

    const report = await importBooks(['C:/下载/三体.epub'], deps)

    expect(deps.fileStore.covers).toEqual([])
    expect(report.added[0]?.coverPath).toBeNull()
  })

  it('同一本书重复导入会被跳过，不会产生第二本', async () => {
    const deps = await setup()

    const first = await importBooks(['C:/下载/三体.epub'], deps)
    const second = await importBooks(['C:/下载/三体.epub'], deps)

    expect(first.added).toHaveLength(1)
    expect(second.added).toEqual([])
    expect(second.skipped).toEqual(first.added)
    await expect(deps.repository.list()).resolves.toHaveLength(1)
  })

  it('元数据缺书名时用文件名兜底', async () => {
    const deps = await setup({ title: null, author: null })

    const report = await importBooks(['C:/下载/三体.epub'], deps)

    expect(report.added[0]?.title).toBe('三体')
    expect(report.added[0]?.author).toBeNull()
  })

  it('没有元数据的 TXT 也能导入，书名取文件名', async () => {
    const fileStore = new FakeFileStore().addTextSource('C:/下载/笔记.txt', '第一章\n正文')

    const report = await importBooks(['C:/下载/笔记.txt'], {
      fileStore,
      repository: new InMemoryBookRepository(),
      now: () => NOW
    })

    expect(report.added[0]).toMatchObject({ title: '笔记', format: 'txt', coverPath: null })
  })

  it('不支持的格式直接判失败，连复制都不会发生', async () => {
    const deps = await setup()

    const report = await importBooks(['C:/下载/手册.pdf'], deps)

    expect(report.failed).toEqual([{ sourcePath: 'C:/下载/手册.pdf', reason: UNSUPPORTED_FORMAT_REASON }])
    expect(deps.fileStore.stored.size).toBe(0)
  })

  it('损坏的 EPUB 会提示原因，并清掉复制进来的坏文件', async () => {
    const fileStore = new FakeFileStore().addTextSource('C:/下载/坏书.epub', '这不是 zip')
    const repository = new InMemoryBookRepository()

    const report = await importBooks(['C:/下载/坏书.epub'], { fileStore, repository, now: () => NOW })

    expect(report.failed).toEqual([{ sourcePath: 'C:/下载/坏书.epub', reason: UNREADABLE_EPUB_REASON }])
    expect(report.added).toEqual([])
    expect(fileStore.removed).toHaveLength(1)
    expect(fileStore.storedByFormat('epub')).toEqual([])
    await expect(repository.list()).resolves.toEqual([])
  })

  it('复制阶段失败的文件同样只记进 failed', async () => {
    const fileStore = new FakeFileStore().failSource('C:/下载/占用的书.epub', '文件被占用')

    const report = await importBooks(['C:/下载/占用的书.epub'], {
      fileStore,
      repository: new InMemoryBookRepository(),
      now: () => NOW
    })

    expect(report.failed).toEqual([{ sourcePath: 'C:/下载/占用的书.epub', reason: '文件被占用' }])
  })

  it('一批文件里个别失败不影响其余书籍入库', async () => {
    const deps = await setup()
    deps.fileStore.addSource('C:/下载/另一本.epub', await buildEpubBytes({ title: '另一本' }))
    deps.fileStore.addTextSource('C:/下载/坏书.epub', '垃圾内容')

    const report = await importBooks(
      ['C:/下载/三体.epub', 'C:/下载/坏书.epub', 'C:/下载/另一本.epub', 'C:/下载/图.png'],
      deps
    )

    expect(report.added.map((book) => book.title)).toEqual(['测试书名', '另一本'])
    expect(report.failed).toHaveLength(2)
    await expect(deps.repository.list()).resolves.toHaveLength(2)
  })

  it('导入前书架上已有的书不会被重复添加', async () => {
    const deps = await setup()
    const first = await importBooks(['C:/下载/三体.epub'], deps)

    // 换一个文件名重新导入同一份内容：id 相同，仍然算重复
    deps.fileStore.addSource('C:/桌面/三体 副本.epub', await buildEpubBytes())

    const second = await importBooks(['C:/桌面/三体 副本.epub'], deps)

    expect(second.skipped).toEqual(first.added)
    expect(second.added).toEqual([])
  })

  it('一个文件都没选中时返回空报告', async () => {
    const deps = await setup()
    const repository = new InMemoryBookRepository()

    const report = await importBooks([], { fileStore: deps.fileStore, repository, now: () => NOW })

    expect(report).toEqual({ added: [], skipped: [], failed: [] })
  })

  it('文件名只剩空白时用「未命名书籍」兜底', async () => {
    const fileStore = new FakeFileStore().addTextSource('C:/下载/   .txt', 'x')

    const report = await importBooks(['C:/下载/   .txt'], {
      fileStore,
      repository: new InMemoryBookRepository(),
      now: () => NOW
    })

    expect(report.added[0]?.title).toBe(UNTITLED_BOOK_TITLE)
  })
})

describe('importBooks 在写入书库失败时的收尾', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** 失败路径会写 console.error，静音掉；要断言的地方自己取 spy。 */
  function spyLogs() {
    return {
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    }
  }

  it('保存失败时记成 failed，并撤掉这次落下的正文与封面', async () => {
    const deps = await setup()
    const logs = spyLogs()
    vi.spyOn(deps.repository, 'save').mockRejectedValueOnce(new Error('磁盘已满'))

    const report = await importBooks(['C:/下载/三体.epub'], deps)

    expect(report.added).toEqual([])
    expect(report.failed).toEqual([{ sourcePath: 'C:/下载/三体.epub', reason: '磁盘已满' }])
    // 书没进库，这次复制进来的两个文件都得走，否则书架上看不到的字节会一直占盘
    expect(deps.fileStore.removed).toHaveLength(1)
    expect(deps.fileStore.removedCovers).toHaveLength(1)
    expect(deps.fileStore.storedByFormat('epub')).toEqual([])
    await expect(deps.repository.list()).resolves.toEqual([])
    expect(logs.error).toHaveBeenCalledWith(expect.stringContaining('三体.epub'), expect.any(Error))
  })

  it('一个文件保存失败不影响后面的文件入库', async () => {
    const deps = await setup()
    spyLogs()
    deps.fileStore.addSource('C:/下载/另一本.epub', await buildEpubBytes({ title: '另一本' }))
    vi.spyOn(deps.repository, 'save').mockRejectedValueOnce(new Error('磁盘已满'))

    const report = await importBooks(['C:/下载/三体.epub', 'C:/下载/另一本.epub'], deps)

    expect(report.failed).toHaveLength(1)
    expect(report.added.map((book) => book.title)).toEqual(['另一本'])
    await expect(deps.repository.list()).resolves.toHaveLength(1)
  })

  it('这次没新建的文件不会被当成本次产物删掉', async () => {
    const deps = await setup()
    spyLogs()
    // 上一次导入留下的同一份内容：真实实现会复用它，不重新写盘
    const primed = await deps.fileStore.import(['C:/下载/三体.epub'])
    expect(primed.imported[0]?.created).toBe(true)

    vi.spyOn(deps.repository, 'save').mockRejectedValueOnce(new Error('磁盘已满'))
    const report = await importBooks(['C:/下载/三体.epub'], deps)

    expect(report.failed).toHaveLength(1)
    expect(deps.fileStore.removed).toEqual([])
    expect(deps.fileStore.storedByFormat('epub')).toHaveLength(1)
  })

  it('保存报错但书其实已经进库时，一个字节都不删', async () => {
    const deps = await setup()
    spyLogs()
    const save = deps.repository.save.bind(deps.repository)
    vi.spyOn(deps.repository, 'save').mockImplementationOnce(async (book) => {
      // 存档实现先改内存再落盘，落盘失败时书已经在库里了
      await save(book)
      throw new Error('磁盘已满')
    })

    const report = await importBooks(['C:/下载/三体.epub'], deps)

    expect(report.failed).toHaveLength(1)
    await expect(deps.repository.list()).resolves.toHaveLength(1)
    // 删了文件就会留下「书架上有条目、点开读不了」，比占盘严重得多
    expect(deps.fileStore.removed).toEqual([])
    expect(deps.fileStore.removedCovers).toEqual([])
    expect(deps.fileStore.storedByFormat('epub')).toHaveLength(1)
  })

  it('写封面失败也只影响这个文件，文案说明真实原因', async () => {
    const deps = await setup()
    spyLogs()
    vi.spyOn(deps.fileStore, 'writeCover').mockRejectedValueOnce(new Error('封面目录不可写'))

    const report = await importBooks(['C:/下载/三体.epub'], deps)

    // 文案不能写成「保存书籍信息失败」：这一步失败的是封面，正文文件该跟着撤掉
    expect(report.failed).toEqual([{ sourcePath: 'C:/下载/三体.epub', reason: '封面目录不可写' }])
    expect(deps.fileStore.removed).toHaveLength(1)
    expect(deps.fileStore.removedCovers).toEqual([])
    await expect(deps.repository.list()).resolves.toEqual([])
  })

  it('读书库文件失败时说明真实原因，而且不删这个文件', async () => {
    const deps = await setup()
    spyLogs()
    vi.spyOn(deps.fileStore, 'read').mockRejectedValueOnce(new Error('文件不在书库目录内'))

    const report = await importBooks(['C:/下载/三体.epub'], deps)

    // 报成「文件已损坏」会把人引向重新下载，但读不出来其实是 IO 或越界
    expect(report.failed).toEqual([{ sourcePath: 'C:/下载/三体.epub', reason: '文件不在书库目录内' }])
    expect(deps.fileStore.removed).toEqual([])
    expect(deps.fileStore.storedByFormat('epub')).toHaveLength(1)
    await expect(deps.repository.list()).resolves.toEqual([])
  })

  it('失败抛出的不是 Error 时用固定文案兜底', async () => {
    const deps = await setup()
    spyLogs()
    vi.spyOn(deps.repository, 'save').mockRejectedValueOnce('磁盘炸了')

    const report = await importBooks(['C:/下载/三体.epub'], deps)

    expect(report.failed).toEqual([{ sourcePath: 'C:/下载/三体.epub', reason: IMPORT_FAILED_REASON }])
    expect(deps.fileStore.removed).toHaveLength(1)
  })
})
