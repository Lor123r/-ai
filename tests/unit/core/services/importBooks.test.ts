import { describe, expect, it } from 'vitest'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { UNTITLED_BOOK_TITLE } from '@core/domain/book'
import {
  importBooks,
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
