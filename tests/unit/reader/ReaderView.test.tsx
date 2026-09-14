import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookContentReaderProvider } from '@renderer/data/BookContentReaderProvider'
import ReaderView from '@renderer/reader/ReaderView'
import type { EpubBook, EpubRendition } from '@renderer/reader/createEpubBook'

afterEach(() => {
  cleanup()
})

interface FakeEpub {
  book: EpubBook
  rendition: EpubRendition
  display: ReturnType<typeof vi.fn>
  next: ReturnType<typeof vi.fn>
  prev: ReturnType<typeof vi.fn>
  destroyRendition: ReturnType<typeof vi.fn>
  destroyBook: ReturnType<typeof vi.fn>
}

/** 假 epub.js：只保留 ReaderView 真正用到的那几个能力。 */
function fakeEpub(options: { ready?: Promise<unknown>; displayError?: Error } = {}): FakeEpub {
  const display = vi.fn(async () => {
    if (options.displayError) throw options.displayError
    return undefined
  })
  const next = vi.fn(async () => undefined)
  const prev = vi.fn(async () => undefined)
  const destroyRendition = vi.fn()
  const destroyBook = vi.fn()

  const rendition: EpubRendition = { display, next, prev, destroy: destroyRendition }
  const book: EpubBook = {
    ready: options.ready ?? Promise.resolve(),
    renderTo: vi.fn(() => rendition),
    destroy: destroyBook
  }

  return { book, rendition, display, next, prev, destroyRendition, destroyBook }
}

interface RenderOptions {
  bytes?: Uint8Array | null
  epub?: FakeEpub
  title?: string
  onClose?: () => void
}

function renderReader(options: RenderOptions = {}): { epub: FakeEpub; createBook: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn> } {
  const epub = options.epub ?? fakeEpub()
  const createBook = vi.fn(() => epub.book)
  const onClose = vi.fn(options.onClose)

  render(
    <BookContentReaderProvider
      reader={{ read: async () => (options.bytes === undefined ? new Uint8Array([1, 2, 3]) : options.bytes) }}
    >
      <ReaderView
        bookId="book-1"
        title={options.title ?? '三体'}
        onClose={onClose}
        createBook={createBook}
      />
    </BookContentReaderProvider>
  )

  return { epub, createBook, onClose }
}

describe('ReaderView', () => {
  it('打开时先显示加载态，随后进入阅读状态', async () => {
    const { epub } = renderReader()

    expect(screen.getByText('正在打开…')).toBeInTheDocument()
    expect(screen.getByLabelText('正在阅读《三体》')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })
    expect(epub.display).toHaveBeenCalledTimes(1)
  })

  it('等书籍 ready 之后才翻到第一页', async () => {
    let release: (value: unknown) => void = () => {}
    const ready = new Promise((resolve) => (release = resolve))
    const { epub } = renderReader({ epub: fakeEpub({ ready }) })

    await waitFor(() => {
      expect(epub.book.renderTo).toHaveBeenCalled()
    })
    expect(epub.display).not.toHaveBeenCalled()

    release(undefined)
    await waitFor(() => {
      expect(epub.display).toHaveBeenCalledTimes(1)
    })
  })

  it('把正文挂到视口上，并用分页模式渲染', async () => {
    const { epub } = renderReader()

    await waitFor(() => {
      expect(epub.book.renderTo).toHaveBeenCalledTimes(1)
    })
    const [element, renderOptions] = (epub.book.renderTo as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]!
    expect((element as HTMLElement).className).toContain('reader__viewport')
    expect(renderOptions).toMatchObject({ flow: 'paginated' })
  })

  it('翻页按钮在就绪前禁用，就绪后调用 epub.js 的 next/prev', async () => {
    const { epub } = renderReader()

    const prev = screen.getByRole('button', { name: '上一页' })
    const next = screen.getByRole('button', { name: '下一页' })
    expect(prev).toBeDisabled()
    expect(next).toBeDisabled()

    await waitFor(() => {
      expect(next).toBeEnabled()
    })

    fireEvent.click(next)
    fireEvent.click(prev)
    await waitFor(() => {
      expect(epub.next).toHaveBeenCalledTimes(1)
    })
    expect(epub.prev).toHaveBeenCalledTimes(1)
  })

  it('翻页失败时展示错误但保留阅读状态', async () => {
    const epub = fakeEpub()
    epub.next.mockRejectedValueOnce(new Error('已经到最后一页'))
    renderReader({ epub })

    const next = screen.getByRole('button', { name: '下一页' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    fireEvent.click(next)

    expect(await screen.findByText('无法打开本书：已经到最后一页')).toBeInTheDocument()
    expect(screen.getByText('阅读中')).toBeInTheDocument()
  })

  it('卸载时销毁 rendition 与 book，避免 iframe 泄漏', async () => {
    const { epub } = renderReader()
    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })

    cleanup()

    expect(epub.destroyRendition).toHaveBeenCalledTimes(1)
    expect(epub.destroyBook).toHaveBeenCalledTimes(1)
  })

  it('书籍文件不存在时提示打开失败', async () => {
    renderReader({ bytes: null })

    expect(await screen.findByText('无法打开本书：书籍文件不存在')).toBeInTheDocument()
    expect(screen.getByText('打开失败')).toBeInTheDocument()
  })

  it('没有正文读取器时（浏览器预览）提示无法打开', async () => {
    render(
      <BookContentReaderProvider reader={null}>
        <ReaderView bookId="book-1" title="三体" onClose={vi.fn()} />
      </BookContentReaderProvider>
    )

    expect(await screen.findByText('无法打开本书：当前环境无法读取书籍正文')).toBeInTheDocument()
  })

  it('epub.js 解析失败时展示错误而不是崩溃', async () => {
    renderReader({ epub: fakeEpub({ displayError: new Error('不是一个合法的 EPUB') }) })

    expect(await screen.findByText('无法打开本书：不是一个合法的 EPUB')).toBeInTheDocument()
  })

  it('点返回书架会通知上层关闭', async () => {
    const { onClose } = renderReader()

    fireEvent.click(screen.getByRole('button', { name: '返回书架' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
