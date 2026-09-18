import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemorySettingsRepository } from '@core/adapters/inMemorySettingsRepository'
import { BookContentReaderProvider } from '@renderer/data/BookContentReaderProvider'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import { SettingsRepositoryProvider } from '@renderer/data/SettingsRepositoryProvider'
import ReaderView from '@renderer/reader/ReaderView'
import { seedRepository } from '../support/fakeRepository'

/**
 * 只替换 EPUB 后端：真的那个要一本 epub.js 的假书才能起来，
 * 这里要断言的是「TXT 书根本不会走到它那边」——没被渲染就是最强的证据。
 * TXT 后端保持真实实现，顺带把 `format` 的分派接到真实链路上验一遍。
 */
vi.mock('@renderer/reader/EpubReaderView', () => ({
  default: () => <p>EPUB 正文后端</p>
}))

afterEach(() => {
  cleanup()
})

async function renderRouter(format: 'epub' | 'txt'): Promise<void> {
  const { repository } = await seedRepository()

  render(
    <BookRepositoryProvider repository={repository}>
      <BookContentReaderProvider
        reader={{ read: async () => new TextEncoder().encode('第一章') }}
      >
        <SettingsRepositoryProvider repository={new InMemorySettingsRepository()}>
          <ReaderView bookId="book-1" title="三体" format={format} onClose={() => undefined} />
        </SettingsRepositoryProvider>
      </BookContentReaderProvider>
    </BookRepositoryProvider>
  )
}

describe('ReaderView 按格式分派', () => {
  it('TXT 交给 TXT 后端，EPUB 后端一次都不碰', async () => {
    await renderRouter('txt')

    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })
    expect(screen.queryByText('EPUB 正文后端')).not.toBeInTheDocument()
    expect(document.querySelector('.reader__viewport--text')).toBeInTheDocument()
    expect(document.querySelector('.txt-reader')).toBeInTheDocument()
  })

  it('EPUB 交给 EPUB 后端，不会套上 TXT 的多栏容器', async () => {
    await renderRouter('epub')

    expect(screen.getByText('EPUB 正文后端')).toBeInTheDocument()
    expect(document.querySelector('.reader__viewport--text')).not.toBeInTheDocument()
    expect(document.querySelector('.txt-reader')).not.toBeInTheDocument()
  })

  it('分派时把书上信息原样转给 TXT 后端', async () => {
    await renderRouter('txt')

    await waitFor(() => {
      expect(screen.getByLabelText('正在阅读《三体》')).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: '三体' })).toBeInTheDocument()
  })
})
