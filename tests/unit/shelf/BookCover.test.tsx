import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoverReader } from '@core/ports/bookCover'
import { CoverReaderProvider } from '@renderer/data/CoverReaderProvider'
import BookCover from '@renderer/shelf/BookCover'

afterEach(() => {
  cleanup()
  delete window.api
})

function renderCover(reader: CoverReader | null, title = '三体', bookId = 'book-1'): void {
  render(
    <CoverReaderProvider reader={reader}>
      <BookCover bookId={bookId} title={title} />
    </CoverReaderProvider>
  )
}

describe('BookCover', () => {
  it('读到封面时渲染图片', async () => {
    renderCover({
      read: async () => ({ bytes: new TextEncoder().encode('PNG'), mediaType: 'image/png' })
    })

    const image = await screen.findByRole('img', { name: '《三体》封面' })
    expect(image).toHaveAttribute('src', 'data:image/png;base64,UE5H')
  })

  it('读不到封面时显示书名首字占位', async () => {
    renderCover({ read: async () => null })

    expect(await screen.findByText('三')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('没有读取器时直接显示占位，不发请求', () => {
    renderCover(null)

    expect(screen.getByText('三')).toBeInTheDocument()
  })

  it('按书籍 id 读取封面', async () => {
    const read = vi.fn(async () => null)
    renderCover({ read }, '样书', 'book-42')

    expect(read).toHaveBeenCalledWith('book-42')
  })

  it('读取失败时退化为占位而不是抛错', async () => {
    renderCover({ read: vi.fn().mockRejectedValue(new Error('封面文件不见了')) })

    expect(await screen.findByText('三')).toBeInTheDocument()
  })

  it('书名首字按码点取，不会把emoji拆成半个', async () => {
    renderCover({ read: async () => null }, '📚 合集')

    expect(await screen.findByText('📚')).toBeInTheDocument()
  })

  it('空书名回落到「书」', async () => {
    renderCover({ read: async () => null }, '')

    expect(await screen.findByText('书')).toBeInTheDocument()
  })
})
