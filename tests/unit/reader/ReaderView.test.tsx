import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocator } from '@core/domain/progress'
import type { BookRepository } from '@core/ports/bookRepository'
import { BookContentReaderProvider } from '@renderer/data/BookContentReaderProvider'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import ReaderView from '@renderer/reader/ReaderView'
import type { EpubBook, EpubRelocation, EpubRendition } from '@renderer/reader/createEpubBook'
import { seedRepository } from '../support/fakeRepository'

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
  /** 模拟 epub.js 翻页后抛出 relocated 事件。 */
  relocate: (location: EpubRelocation) => void
}

/** 假 epub.js：只保留 ReaderView 真正用到的那几个能力。 */
function fakeEpub(
  options: { ready?: Promise<unknown>; displayError?: Error; spineCount?: number } = {}
): FakeEpub {
  const display = vi.fn(async () => {
    if (options.displayError) throw options.displayError
    return undefined
  })
  const next = vi.fn(async () => undefined)
  const prev = vi.fn(async () => undefined)
  const destroyRendition = vi.fn()
  const destroyBook = vi.fn()
  const relocationHandlers: ((location: EpubRelocation) => void)[] = []

  const rendition: EpubRendition = {
    display,
    next,
    prev,
    on: (_event, handler) => {
      relocationHandlers.push(handler)
    },
    destroy: destroyRendition
  }
  const book: EpubBook = {
    ready: options.ready ?? Promise.resolve(),
    spine: { length: options.spineCount ?? 10 },
    renderTo: vi.fn(() => rendition),
    destroy: destroyBook
  }

  return {
    book,
    rendition,
    display,
    next,
    prev,
    destroyRendition,
    destroyBook,
    relocate: (location) => {
      for (const handler of relocationHandlers) handler(location)
    }
  }
}

interface RenderOptions {
  bytes?: Uint8Array | null
  epub?: FakeEpub
  title?: string
  onClose?: () => void
  repository?: BookRepository
  reader?: { read: (bookId: string) => Promise<Uint8Array | null> } | null
  now?: () => number
}

interface RenderResult {
  epub: FakeEpub
  createBook: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
}

async function renderReader(options: RenderOptions = {}): Promise<RenderResult> {
  const epub = options.epub ?? fakeEpub()
  const createBook = vi.fn(() => epub.book)
  const onClose = vi.fn(options.onClose)
  const repository = options.repository ?? (await seedRepository()).repository
  const reader =
    options.reader === undefined
      ? { read: async () => (options.bytes === undefined ? new Uint8Array([1, 2, 3]) : options.bytes) }
      : options.reader

  render(
    <BookRepositoryProvider repository={repository}>
      <BookContentReaderProvider reader={reader}>
        <ReaderView
          bookId="book-1"
          title={options.title ?? '三体'}
          onClose={onClose}
          createBook={createBook}
          now={options.now}
        />
      </BookContentReaderProvider>
    </BookRepositoryProvider>
  )

  return { epub, createBook, onClose }
}

describe('ReaderView', () => {
  it('打开时先显示加载态，随后进入阅读状态', async () => {
    const { epub } = await renderReader()

    expect(screen.getByText('正在打开…')).toBeInTheDocument()
    expect(screen.getByLabelText('正在阅读《三体》')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })
    expect(epub.display).toHaveBeenCalledTimes(1)
  })

  it('等书籍 ready 之后才翻到第一页', async () => {
    let release: (value: unknown) => void = () => undefined
    const ready = new Promise((resolve) => (release = resolve))
    const { epub } = await renderReader({ epub: fakeEpub({ ready }) })

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
    const { epub } = await renderReader()

    await waitFor(() => {
      expect(epub.book.renderTo).toHaveBeenCalledTimes(1)
    })
    const [element, renderOptions] = (epub.book.renderTo as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]!
    expect((element as HTMLElement).className).toContain('reader__viewport')
    expect(renderOptions).toMatchObject({ flow: 'paginated' })
  })

  it('翻页按钮在就绪前禁用，就绪后调用 epub.js 的 next/prev', async () => {
    const { epub } = await renderReader()

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
    await renderReader({ epub })

    const next = screen.getByRole('button', { name: '下一页' })
    await waitFor(() => {
      expect(next).toBeEnabled()
    })
    fireEvent.click(next)

    expect(await screen.findByText('无法打开本书：已经到最后一页')).toBeInTheDocument()
    expect(screen.getByText('阅读中')).toBeInTheDocument()
  })

  it('卸载时销毁 rendition 与 book，避免 iframe 泄漏', async () => {
    const { epub } = await renderReader()
    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })

    cleanup()

    expect(epub.destroyRendition).toHaveBeenCalledTimes(1)
    expect(epub.destroyBook).toHaveBeenCalledTimes(1)
  })

  it('书籍文件不存在时提示打开失败', async () => {
    await renderReader({ bytes: null })

    expect(await screen.findByText('无法打开本书：书籍文件不存在')).toBeInTheDocument()
    expect(screen.getByText('打开失败')).toBeInTheDocument()
  })

  it('没有正文读取器时（浏览器预览）提示无法打开', async () => {
    await renderReader({ reader: null })

    expect(await screen.findByText('无法打开本书：当前环境无法读取书籍正文')).toBeInTheDocument()
  })

  it('epub.js 解析失败时展示错误而不是崩溃', async () => {
    await renderReader({ epub: fakeEpub({ displayError: new Error('不是一个合法的 EPUB') }) })

    expect(await screen.findByText('无法打开本书：不是一个合法的 EPUB')).toBeInTheDocument()
  })

  it('点返回书架会通知上层关闭', async () => {
    const { onClose } = await renderReader()

    fireEvent.click(screen.getByRole('button', { name: '返回书架' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ReaderView 阅读进度', () => {
  it('有存档时从上次的 CFI 恢复，并先把上次的百分比显示出来', async () => {
    const { repository, book } = await seedRepository()
    await repository.saveLocator(
      book.id,
      createLocator({ cfi: 'epubcfi(/6/8!/4/2)', percent: 0.42, chapterIndex: 3 }, 1)
    )
    const { epub } = await renderReader({ repository })

    await waitFor(() => {
      expect(screen.getByLabelText('阅读进度')).toHaveTextContent('42%')
    })
    expect(epub.display).toHaveBeenCalledWith('epubcfi(/6/8!/4/2)')
  })

  it('没有存档时从卷首开始，也不显示进度', async () => {
    const { epub } = await renderReader()

    await waitFor(() => {
      expect(epub.display).toHaveBeenCalledWith(undefined)
    })
    expect(screen.queryByLabelText('阅读进度')).not.toBeInTheDocument()
  })

  it('epub.js 报出新位置后落盘 CFI 与百分比，并刷新进度显示', async () => {
    const { repository, book } = await seedRepository()
    const spy = vi.spyOn(repository, 'saveLocator')
    const { epub } = await renderReader({ repository, epub: fakeEpub({ spineCount: 10 }) })
    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })

    epub.relocate({
      start: { index: 5, cfi: 'epubcfi(/6/12!/4/2)', displayed: { page: 6, total: 11 } },
      atEnd: false
    })

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({ cfi: 'epubcfi(/6/12!/4/2)', percent: 0.55, chapterIndex: 5 })
      )
    })
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('55%')
  })

  it('翻到全书的最后一页就是 100%', async () => {
    const { repository, book } = await seedRepository()
    const spy = vi.spyOn(repository, 'saveLocator')
    const { epub } = await renderReader({ repository, epub: fakeEpub({ spineCount: 10 }) })
    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })

    epub.relocate({ start: { index: 9, cfi: 'epubcfi(/6/20!/4/2)' }, atEnd: true })

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(book.id, expect.objectContaining({ percent: 1 }))
    })
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('100%')
  })

  it('同一位置反复上报只写一次', async () => {
    const { repository } = await seedRepository()
    const spy = vi.spyOn(repository, 'saveLocator')
    const { epub } = await renderReader({ repository })
    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })

    const location: EpubRelocation = {
      start: { index: 2, cfi: 'epubcfi(/6/6!/4/2)', displayed: { page: 1, total: 4 } },
      atEnd: false
    }
    epub.relocate(location)
    epub.relocate(location)
    epub.relocate(location)

    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })

  it('打开成功后会更新最后打开时间，好让书架上最近读的书排前面', async () => {
    const { repository, book } = await seedRepository()
    const openedAt = 1_800_000_000_000
    await renderReader({ repository, now: () => openedAt })

    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })
    await expect(repository.get(book.id)).resolves.toMatchObject({ lastOpenedAt: openedAt })
  })

  it('进度落盘失败不影响继续阅读，也不打扰用户', async () => {
    const { repository } = await seedRepository()
    const saveLocator = vi.fn(async () => {
      throw new Error('磁盘满了')
    })
    const failing: BookRepository = {
      list: () => repository.list(),
      get: (id) => repository.get(id),
      save: (entry) => repository.save(entry),
      remove: (id) => repository.remove(id),
      getLocator: (id) => repository.getLocator(id),
      saveLocator,
      markOpened: (id, openedAt) => repository.markOpened(id, openedAt)
    }
    const { epub } = await renderReader({ repository: failing })
    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })

    epub.relocate({ start: { index: 1, cfi: 'epubcfi(/6/4!/4/2)' }, atEnd: false })

    await waitFor(() => {
      expect(saveLocator).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText('阅读中')).toBeInTheDocument()
    expect(screen.queryByText(/磁盘满了/)).not.toBeInTheDocument()
  })
})
