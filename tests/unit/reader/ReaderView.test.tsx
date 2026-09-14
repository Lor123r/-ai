import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocator } from '@core/domain/progress'
import { DEFAULT_READER_SETTINGS } from '@core/domain/settings'
import type { BookRepository } from '@core/ports/bookRepository'
import type { SettingsRepository } from '@core/ports/settingsRepository'
import { BookContentReaderProvider } from '@renderer/data/BookContentReaderProvider'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import { SettingsRepositoryProvider } from '@renderer/data/SettingsRepositoryProvider'
import { InMemorySettingsRepository } from '@core/adapters/inMemorySettingsRepository'
import ReaderView from '@renderer/reader/ReaderView'
import type {
  EpubBook,
  EpubNavItem,
  EpubRelocation,
  EpubRendition
} from '@renderer/reader/createEpubBook'
import { READER_THEME_COLORS } from '@renderer/reader/readerAppearance'
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
  resize: ReturnType<typeof vi.fn>
  override: ReturnType<typeof vi.fn>
  destroyRendition: ReturnType<typeof vi.fn>
  destroyBook: ReturnType<typeof vi.fn>
  /** 模拟 epub.js 翻页后抛出 relocated 事件。 */
  relocate: (location: EpubRelocation) => void
}

interface FakeEpubOptions {
  ready?: Promise<unknown>
  displayError?: Error
  spineCount?: number
  toc?: EpubNavItem[]
  /** spine 里各章的路径，用来验证目录链接会被对齐到 OPF 相对路径。 */
  spineUrls?: string[]
  /** 故意不给主题能力，模拟不支持 override 的渲染器。 */
  withoutThemes?: boolean
}

/** 假 epub.js：只保留 ReaderView 真正用到的那几个能力。 */
function fakeEpub(options: FakeEpubOptions = {}): FakeEpub {
  const display = vi.fn(async () => {
    if (options.displayError) throw options.displayError
    return undefined
  })
  const next = vi.fn(async () => undefined)
  const prev = vi.fn(async () => undefined)
  const resize = vi.fn()
  const override = vi.fn()
  const destroyRendition = vi.fn()
  const destroyBook = vi.fn()
  const relocationHandlers: ((location: EpubRelocation) => void)[] = []

  const rendition: EpubRendition = {
    display,
    next,
    prev,
    resize,
    on: (_event, handler) => {
      relocationHandlers.push(handler)
    },
    destroy: destroyRendition
  }
  if (!options.withoutThemes) rendition.themes = { override }

  const book: EpubBook = {
    ready: options.ready ?? Promise.resolve(),
    spine: {
      length: options.spineCount ?? 10,
      each: (callback) => {
        for (const href of options.spineUrls ?? []) callback({ href })
      }
    },
    navigation: { toc: options.toc ?? [] },
    renderTo: vi.fn(() => rendition),
    destroy: destroyBook
  }

  return {
    book,
    rendition,
    display,
    next,
    prev,
    resize,
    override,
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
  settingsRepository?: SettingsRepository
  reader?: { read: (bookId: string) => Promise<Uint8Array | null> } | null
  now?: () => number
}

interface RenderResult {
  epub: FakeEpub
  createBook: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  settings: SettingsRepository
}

async function renderReader(options: RenderOptions = {}): Promise<RenderResult> {
  const epub = options.epub ?? fakeEpub()
  const createBook = vi.fn(() => epub.book)
  const onClose = vi.fn(options.onClose)
  const repository = options.repository ?? (await seedRepository()).repository
  const settings = options.settingsRepository ?? new InMemorySettingsRepository()
  const reader =
    options.reader === undefined
      ? { read: async () => (options.bytes === undefined ? new Uint8Array([1, 2, 3]) : options.bytes) }
      : options.reader

  render(
    <BookRepositoryProvider repository={repository}>
      <BookContentReaderProvider reader={reader}>
        <SettingsRepositoryProvider repository={settings}>
          <ReaderView
            bookId="book-1"
            title={options.title ?? '三体'}
            onClose={onClose}
            createBook={createBook}
            now={options.now}
          />
        </SettingsRepositoryProvider>
      </BookContentReaderProvider>
    </BookRepositoryProvider>
  )

  return { epub, createBook, onClose, settings }
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

describe('ReaderView 目录', () => {
  const toc: EpubNavItem[] = [
    { id: 'c1', href: 'Text/ch1.xhtml', label: '第一章 科学边界' },
    {
      id: 'c2',
      href: 'Text/ch2.xhtml',
      label: '第二章 台球',
      subitems: [{ id: 'c2-1', href: 'Text/ch2.xhtml#part2', label: '第二章 附录' }]
    }
  ]

  it('就绪前目录按钮不可用，就绪后可以打开抽屉', async () => {
    const { epub } = await renderReader({ epub: fakeEpub({ toc }) })

    const toggle = screen.getByRole('button', { name: '目录' })
    expect(toggle).toBeDisabled()

    await waitFor(() => {
      expect(toggle).toBeEnabled()
    })
    expect(screen.queryByRole('complementary', { name: '目录' })).not.toBeInTheDocument()

    fireEvent.click(toggle)

    const drawer = await screen.findByRole('complementary', { name: '目录' })
    expect(drawer).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '第一章 科学边界' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '第二章 附录' })).toBeInTheDocument()
    expect(epub.book.renderTo).toHaveBeenCalledTimes(1)
  })

  it('点目录项跳到对应章节并收起抽屉', async () => {
    const { epub } = await renderReader({ epub: fakeEpub({ toc }) })
    const toggle = screen.getByRole('button', { name: '目录' })
    await waitFor(() => {
      expect(toggle).toBeEnabled()
    })
    fireEvent.click(toggle)

    fireEvent.click(await screen.findByRole('button', { name: '第二章 台球' }))

    await waitFor(() => {
      expect(epub.display).toHaveBeenLastCalledWith('Text/ch2.xhtml')
    })
    expect(screen.queryByRole('complementary', { name: '目录' })).not.toBeInTheDocument()
  })

  it('目录里的相对链接会被对齐到 spine 的路径', async () => {
    const epub = fakeEpub({
      toc: [{ id: 'c1', href: '../Text/ch1.xhtml#top', label: '第一章' }],
      spineUrls: ['Text/ch1.xhtml', 'Text/ch2.xhtml']
    })
    await renderReader({ epub })
    const toggle = screen.getByRole('button', { name: '目录' })
    await waitFor(() => {
      expect(toggle).toBeEnabled()
    })
    fireEvent.click(toggle)
    fireEvent.click(await screen.findByRole('button', { name: '第一章' }))

    await waitFor(() => {
      expect(epub.display).toHaveBeenLastCalledWith('Text/ch1.xhtml#top')
    })
  })

  it('没有目录时给出提示而不是空白抽屉', async () => {
    await renderReader({ epub: fakeEpub({ toc: [] }) })
    const toggle = screen.getByRole('button', { name: '目录' })
    await waitFor(() => {
      expect(toggle).toBeEnabled()
    })

    fireEvent.click(toggle)

    expect(await screen.findByText('这本书没有提供目录')).toBeInTheDocument()
  })

  it('跳转失败时提示错误，不影响继续阅读', async () => {
    const epub = fakeEpub({ toc })
    await renderReader({ epub })
    const toggle = screen.getByRole('button', { name: '目录' })
    await waitFor(() => {
      expect(toggle).toBeEnabled()
    })
    fireEvent.click(toggle)

    epub.display.mockRejectedValueOnce(new Error('No Section Found'))
    fireEvent.click(await screen.findByRole('button', { name: '第一章 科学边界' }))

    expect(await screen.findByText('无法打开本书：No Section Found')).toBeInTheDocument()
    expect(screen.getByText('阅读中')).toBeInTheDocument()
  })
})

describe('ReaderView 阅读设置', () => {
  /** 时钟停在 0：让连续改动落进同一个节流窗口，便于验证合并。 */
  const FROZEN_CLOCK = (): number => 0

  async function renderReady(options: RenderOptions = {}): Promise<RenderResult> {
    const result = await renderReader(options)
    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })
    return result
  }

  function openSettings(): HTMLElement {
    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    return screen.getByRole('complementary', { name: '阅读设置' })
  }

  it('启动时把保存过的设置应用到正文样式', async () => {
    const settings = new InMemorySettingsRepository({ ...DEFAULT_READER_SETTINGS, fontSize: 24, theme: 'night' })
    const { epub } = await renderReady({ epub: fakeEpub(), settingsRepository: settings })

    expect(epub.override).toHaveBeenCalledWith('font-size', '24px', true)
    expect(epub.override).toHaveBeenCalledWith('background-color', READER_THEME_COLORS.night.paper, true)
  })

  it('改字号会立刻重设正文样式并落盘', async () => {
    const settings = new InMemorySettingsRepository()
    const save = vi.spyOn(settings, 'save')
    const { epub } = await renderReady({ settingsRepository: settings })

    openSettings()
    fireEvent.click(screen.getByRole('button', { name: '增大字号' }))

    expect(epub.override).toHaveBeenCalledWith('font-size', '19px', true)
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 19 }))
    })
    await expect(settings.load()).resolves.toMatchObject({ fontSize: 19 })
  })

  it('连点字号只落盘最终值', async () => {
    const settings = new InMemorySettingsRepository()
    const save = vi.spyOn(settings, 'save')
    await renderReady({ settingsRepository: settings, now: FROZEN_CLOCK })

    openSettings()
    const bigger = screen.getByRole('button', { name: '增大字号' })
    fireEvent.click(bigger)
    fireEvent.click(bigger)
    fireEvent.click(bigger)

    expect(screen.getByText('21 px')).toBeInTheDocument()
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1)
    })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 21 }))
    await expect(settings.load()).resolves.toMatchObject({ fontSize: 21 })
  })

  it('字号到上限后按钮禁用', async () => {
    const settings = new InMemorySettingsRepository({ ...DEFAULT_READER_SETTINGS, fontSize: 36 })
    await renderReady({ settingsRepository: settings })

    openSettings()

    expect(screen.getByRole('button', { name: '增大字号' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '减小字号' })).toBeEnabled()
  })

  it('切主题会换掉外壳主题色，并把正文字色交给 epub.js', async () => {
    const settings = new InMemorySettingsRepository()
    const save = vi.spyOn(settings, 'save')
    const { epub } = await renderReady({ settingsRepository: settings })

    openSettings()
    fireEvent.click(screen.getByRole('button', { name: '夜间' }))

    expect(screen.getByLabelText('正在阅读《三体》')).toHaveAttribute('data-theme', 'night')
    expect(epub.override).toHaveBeenCalledWith('color', READER_THEME_COLORS.night.ink, true)
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ theme: 'night' }))
    })
  })

  it('改页边距走容器内边距并让 epub.js 重新排版', async () => {
    const settings = new InMemorySettingsRepository()
    const { epub } = await renderReady({ settingsRepository: settings })
    const viewport = document.querySelector('.reader__viewport') as HTMLElement
    expect(viewport.style.padding).toBe('32px')

    openSettings()
    fireEvent.click(screen.getByRole('button', { name: '减小页边距' }))

    expect(viewport.style.padding).toBe('28px')
    expect(epub.resize).toHaveBeenCalled()
  })

  it('改字体时带上 !important，好盖住书内自带的字体', async () => {
    const { epub } = await renderReady()
    openSettings()

    fireEvent.click(screen.getByRole('button', { name: '黑体' }))

    expect(epub.override).toHaveBeenCalledWith('font-family', expect.stringContaining('Microsoft YaHei'), true)
    expect(screen.getByRole('button', { name: '黑体' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '宋体' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('渲染器不支持主题时设置面板仍可改，不会崩溃', async () => {
    const settings = new InMemorySettingsRepository()
    await renderReady({ epub: fakeEpub({ withoutThemes: true }), settingsRepository: settings })

    openSettings()
    fireEvent.click(screen.getByRole('button', { name: '增大字号' }))

    expect(screen.getByText('19 px')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })
  })

  it('读设置失败时回落到默认值继续阅读', async () => {
    const failing: SettingsRepository = {
      load: () => Promise.reject(new Error('配置损坏')),
      save: () => Promise.resolve()
    }
    const { epub } = await renderReady({ epub: fakeEpub(), settingsRepository: failing })

    expect(epub.override).toHaveBeenCalledWith('font-size', `${DEFAULT_READER_SETTINGS.fontSize}px`, true)
    expect(screen.getByText('阅读中')).toBeInTheDocument()
  })
})
