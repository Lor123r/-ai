import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { createBook } from '@core/domain/book'
import type { BookImportSummary, BookImporter } from '@core/ports/bookImporter'
import type { BookRepository } from '@core/ports/bookRepository'
import { BookImporterProvider } from '@renderer/data/BookImporterProvider'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import Bookshelf from '@renderer/shelf/Bookshelf'

afterEach(() => {
  cleanup()
  delete window.api
})

function seedBook(id: string, title: string) {
  return {
    ...createBook({
      id,
      title,
      author: '作者甲',
      format: 'epub' as const,
      filePath: `C:/lib/${id}.epub`,
      fileSize: 1024
    }),
    lastOpenedAt: null
  }
}

function renderShelf(repository: BookRepository, importer: BookImporter | null): void {
  render(
    <BookRepositoryProvider repository={repository}>
      <BookImporterProvider importer={importer}>
        <Bookshelf />
      </BookImporterProvider>
    </BookRepositoryProvider>
  )
}

const SUCCESS: BookImportSummary = { added: 2, skipped: 0, failed: [] }

describe('书架导入入口', () => {
  it('没有导入器时不渲染导入按钮', async () => {
    renderShelf(new InMemoryBookRepository(), null)

    expect(await screen.findByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入书籍' })).not.toBeInTheDocument()
  })

  it('导入成功后刷新书架并展示结果提示', async () => {
    const repo = new InMemoryBookRepository()
    const importer: BookImporter = {
      pickAndImport: vi.fn(async () => {
        await repo.save(seedBook('new', '新导入的书'))
        return SUCCESS
      })
    }

    renderShelf(repo, importer)
    fireEvent.click(await screen.findByRole('button', { name: '导入书籍' }))

    expect(await screen.findByRole('heading', { name: '新导入的书' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已导入 2 本')
    expect(screen.queryByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).not.toBeInTheDocument()
  })

  it('用户取消选择时提示与书架都不变', async () => {
    const repo = new InMemoryBookRepository()
    await repo.save(seedBook('a', '原有的书'))

    renderShelf(repo, { pickAndImport: vi.fn(async () => null) })
    await screen.findByRole('heading', { name: '原有的书' })
    fireEvent.click(screen.getByRole('button', { name: '导入书籍' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '导入书籍' })).toBeEnabled()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '原有的书' })).toBeInTheDocument()
  })

  it('有文件未能导入时额外展示失败明细', async () => {
    const repo = new InMemoryBookRepository()
    const summary: BookImportSummary = {
      added: 1,
      skipped: 1,
      failed: [{ sourcePath: 'C:\\下载\\坏书.epub', reason: '无法解析 EPUB 文件（文件可能已损坏）' }]
    }

    renderShelf(repo, { pickAndImport: vi.fn(async () => summary) })
    fireEvent.click(await screen.findByRole('button', { name: '导入书籍' }))

    expect(await screen.findByRole('status')).toHaveTextContent('已导入 1 本，跳过 1 本重复书籍，1 个文件未能导入')
    expect(screen.getByText('操作失败：坏书.epub：无法解析 EPUB 文件（文件可能已损坏）')).toBeInTheDocument()
  })

  it('导入进行中按钮禁用并改文案，避免重复弹框', async () => {
    let release: (summary: BookImportSummary) => void = () => {}
    const importer: BookImporter = {
      pickAndImport: () => new Promise<BookImportSummary>((resolve) => (release = resolve))
    }

    renderShelf(new InMemoryBookRepository(), importer)
    fireEvent.click(await screen.findByRole('button', { name: '导入书籍' }))

    const busy = screen.getByRole('button', { name: '正在导入…' })
    expect(busy).toBeDisabled()

    release(SUCCESS)
    expect(await screen.findByRole('button', { name: '导入书籍' })).toBeEnabled()
  })

  it('导入抛错时展示错误横幅而不是崩溃', async () => {
    const repo = new InMemoryBookRepository()
    renderShelf(repo, { pickAndImport: vi.fn().mockRejectedValue(new Error('文件选择框打不开')) })

    fireEvent.click(await screen.findByRole('button', { name: '导入书籍' }))

    expect(await screen.findByText('操作失败：文件选择框打不开')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入书籍' })).toBeEnabled()
  })
})
