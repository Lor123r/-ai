import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { createBook } from '@core/domain/book'
import { createLocator } from '@core/domain/progress'
import type { BookRepository } from '@core/ports/bookRepository'
import type { CoverReader } from '@core/ports/bookCover'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import { CoverReaderProvider } from '@renderer/data/CoverReaderProvider'
import Bookshelf from '@renderer/shelf/Bookshelf'

afterEach(() => {
  cleanup()
  delete window.api
})

function seed(id: string, overrides: { title?: string; author?: string | null; lastOpenedAt?: number | null } = {}) {
  return {
    ...createBook({
      id,
      title: overrides.title ?? `书 ${id}`,
      author: overrides.author === undefined ? '作者甲' : overrides.author,
      format: 'epub',
      filePath: `C:/lib/${id}.epub`,
      fileSize: 1024
    }),
    lastOpenedAt: overrides.lastOpenedAt ?? null
  }
}

function renderShelf(repository: BookRepository, reader: CoverReader | null = null): void {
  render(
    <BookRepositoryProvider repository={repository}>
      <CoverReaderProvider reader={reader}>
        <Bookshelf />
      </CoverReaderProvider>
    </BookRepositoryProvider>
  )
}

/** 以真实内存实现为底，只替换需要制造故障的方法。 */
function stubRepository(overrides: Partial<BookRepository>): BookRepository {
  const base = new InMemoryBookRepository()
  return {
    list: () => base.list(),
    get: (id) => base.get(id),
    save: (book) => base.save(book),
    remove: (id) => base.remove(id),
    getLocator: (id) => base.getLocator(id),
    saveLocator: (id, locator) => base.saveLocator(id, locator),
    markOpened: (id, openedAt) => base.markOpened(id, openedAt),
    ...overrides
  }
}

describe('Bookshelf', () => {
  it('空仓库时展示空态提示并隐藏书籍数量', async () => {
    renderShelf(new InMemoryBookRepository())

    expect(await screen.findByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toBeInTheDocument()
    expect(screen.queryByText(/\d+ 本/)).not.toBeInTheDocument()
  })

  it('展示书名、作者、数量与阅读百分比', async () => {
    const repo = new InMemoryBookRepository()
    await repo.save(seed('a', { title: '三体', author: '刘慈欣' }))
    await repo.save(seed('b', { title: '无作者的书', author: null }))
    await repo.saveLocator('a', createLocator({ cfi: 'epubcfi(/6/4!/4/2)', percent: 0.426, chapterIndex: 1 }))

    renderShelf(repo)

    expect(await screen.findByRole('heading', { name: '三体' })).toBeInTheDocument()
    expect(screen.getByText('刘慈欣')).toBeInTheDocument()
    expect(screen.getByText('未知作者')).toBeInTheDocument()
    expect(screen.getByText('2 本')).toBeInTheDocument()
    expect(screen.getByText('已读 43%')).toBeInTheDocument()
    expect(screen.getByText('尚未开始')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '三体 阅读进度' })).toHaveAttribute('aria-valuenow', '43')
  })

  it('读到结尾的书标记为已读完', async () => {
    const repo = new InMemoryBookRepository()
    await repo.save(seed('a', { title: '已读完的书' }))
    await repo.saveLocator('a', createLocator({ percent: 1 }, 1))

    renderShelf(repo)

    expect(await screen.findByText('已读完')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '已读完的书 阅读进度' })).toHaveAttribute('aria-valuenow', '100')
  })

  it('按最近阅读时间排序，最近打开的在最前', async () => {
    const repo = new InMemoryBookRepository()
    await repo.save(seed('old', { title: '旧书' }))
    await repo.save(seed('new', { title: '新书' }))
    await repo.markOpened('old', 9_999)

    renderShelf(repo)

    await screen.findByRole('heading', { name: '旧书' })
    const titles = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)
    expect(titles).toEqual(['旧书', '新书'])
  })

  it('点击删除会移除书籍并更新计数', async () => {
    const repo = new InMemoryBookRepository()
    await repo.save(seed('a', { title: '要删掉的书' }))
    await repo.save(seed('b', { title: '留下的书' }))

    renderShelf(repo)
    await screen.findByRole('heading', { name: '要删掉的书' })

    fireEvent.click(screen.getByRole('button', { name: '删除《要删掉的书》' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '要删掉的书' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: '留下的书' })).toBeInTheDocument()
    expect(screen.getByText('1 本')).toBeInTheDocument()
    await expect(repo.list()).resolves.toHaveLength(1)
  })

  it('删除失败时展示错误横幅而不是崩溃', async () => {
    const store = new InMemoryBookRepository()
    await store.save(seed('a', { title: '删不掉的书' }))
    const repo = stubRepository({
      list: () => store.list(),
      getLocator: (id) => store.getLocator(id),
      remove: vi.fn().mockRejectedValue(new Error('磁盘被占用'))
    })

    renderShelf(repo)
    await screen.findByRole('heading', { name: '删不掉的书' })

    fireEvent.click(screen.getByRole('button', { name: '删除《删不掉的书》' }))

    expect(await screen.findByText('操作失败：磁盘被占用')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '删不掉的书' })).toBeInTheDocument()
  })

  it('读取失败时展示错误提示', async () => {
    const repo = stubRepository({ list: vi.fn().mockRejectedValue(new Error('数据库损坏')) })

    renderShelf(repo)

    expect(await screen.findByText('读取书架失败：数据库损坏')).toBeInTheDocument()
  })

  it('每张卡片都按自己的书籍 id 取封面', async () => {
    const repo = new InMemoryBookRepository()
    await repo.save(seed('a', { title: '有封面的书' }))
    await repo.save(seed('b', { title: '没封面的书' }))
    const read = vi.fn(async (bookId: string) =>
      bookId === 'a' ? { bytes: new TextEncoder().encode('PNG'), mediaType: 'image/png' } : null
    )

    renderShelf(repo, { read })

    expect(await screen.findByRole('img', { name: '《有封面的书》封面' })).toBeInTheDocument()
    expect(screen.getByText('没')).toBeInTheDocument()
    expect(read.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b'])
  })
})
