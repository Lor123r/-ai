import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocator } from '@core/domain/progress'
import { DEFAULT_READER_SETTINGS } from '@core/domain/settings'
import { createBookmark, createHighlight } from '@core/domain/annotation'
import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import type { BookRepository } from '@core/ports/bookRepository'
import type { SettingsRepository } from '@core/ports/settingsRepository'
import { AnnotationRepositoryProvider } from '@renderer/data/AnnotationRepositoryProvider'
import { BookContentReaderProvider } from '@renderer/data/BookContentReaderProvider'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import { SettingsRepositoryProvider } from '@renderer/data/SettingsRepositoryProvider'
import { InMemorySettingsRepository } from '@core/adapters/inMemorySettingsRepository'
import { BOOKMARK_MARK_DATA, BOOKMARK_MARK_TYPE } from '@renderer/reader/annotationHighlight'
import ReaderView from '@renderer/reader/ReaderView'
import {
  ANNOTATIONS_UNAVAILABLE_MESSAGE,
  ANNOTATION_SAVE_FAILED_MESSAGE
} from '@renderer/reader/useBookAnnotations'
import type {
  EpubAnnotationLayer,
  EpubBook,
  EpubContents,
  EpubNavItem,
  EpubRelocation,
  EpubRendition
} from '@renderer/reader/createEpubBook'
import { READER_THEME_COLORS } from '@renderer/reader/readerAppearance'
import { HIGHLIGHT_COLOR_LABELS, highlightFill } from '@renderer/reader/highlightPalette'
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
  annotations: FakeAnnotationLayer
  /** 模拟 epub.js 翻页后抛出 relocated 事件。 */
  relocate: (location: EpubRelocation) => void
  /** 模拟 epub.js 在 iframe 里选中文字后抛出 selected 事件。 */
  select: (cfiRange: string, contents: EpubContents) => void
}

interface FakeAnnotationLayer {
  add: EpubAnnotationLayer['add']
  remove: EpubAnnotationLayer['remove']
  /** 画过的标记，按调用顺序；断言重复 add / 孤儿 mark 就靠它。 */
  added: { type: string; cfiRange: string; data: object | undefined; styles: object | undefined }[]
  /** 擦过的标记，按调用顺序。 */
  removed: { cfiRange: string; type: string }[]
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
  // 真实 epub.js 按事件名分桶派发，假实现也必须照做：
  // 混在一个数组里的话 relocated 的 handler 会被 selected 事件打到（设计稿 H5）
  const listeners = new Map<string, ((...payload: never[]) => void)[]>()

  function emit(event: string, ...payload: unknown[]): void {
    for (const handler of listeners.get(event) ?? []) {
      ;(handler as unknown as (...args: unknown[]) => void)(...payload)
    }
  }

  const annotations: FakeAnnotationLayer = {
    added: [],
    removed: [],
    add(type, cfiRange, data, _callback, _className, styles) {
      annotations.added.push({ type, cfiRange, data, styles })
    },
    remove(cfiRange, type) {
      annotations.removed.push({ cfiRange, type })
    }
  }

  const rendition: EpubRendition = {
    display,
    next,
    prev,
    resize,
    on: (event, handler) => {
      const list = listeners.get(event) ?? []
      list.push(handler as unknown as (...payload: never[]) => void)
      listeners.set(event, list)
    },
    annotations,
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
    annotations,
    relocate: (location) => emit('relocated', location),
    select: (cfiRange, contents) => emit('selected', cfiRange, contents)
  }
}

interface RenderOptions {
  bytes?: Uint8Array | null
  epub?: FakeEpub
  title?: string
  onClose?: () => void
  repository?: BookRepository
  settingsRepository?: SettingsRepository
  annotationRepository?: AnnotationRepository
  reader?: { read: (bookId: string) => Promise<Uint8Array | null> } | null
  now?: () => number
}

interface RenderResult {
  epub: FakeEpub
  createBook: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  settings: SettingsRepository
  annotations: AnnotationRepository
}

async function renderReader(options: RenderOptions = {}): Promise<RenderResult> {
  const epub = options.epub ?? fakeEpub()
  const createBook = vi.fn(() => epub.book)
  const onClose = vi.fn(options.onClose)
  const repository = options.repository ?? (await seedRepository()).repository
  const settings = options.settingsRepository ?? new InMemorySettingsRepository()
  const annotations = options.annotationRepository ?? new InMemoryAnnotationRepository()
  const reader =
    options.reader === undefined
      ? { read: async () => (options.bytes === undefined ? new Uint8Array([1, 2, 3]) : options.bytes) }
      : options.reader

  render(
    <BookRepositoryProvider repository={repository}>
      <BookContentReaderProvider reader={reader}>
        <SettingsRepositoryProvider repository={settings}>
          <AnnotationRepositoryProvider repository={annotations}>
            <ReaderView
              bookId="book-1"
              title={options.title ?? '三体'}
              onClose={onClose}
              createBook={createBook}
              now={options.now}
            />
          </AnnotationRepositoryProvider>
        </SettingsRepositoryProvider>
      </BookContentReaderProvider>
    </BookRepositoryProvider>
  )

  return { epub, createBook, onClose, settings, annotations }
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

describe('ReaderView 书签与划线', () => {
  /** LOCATION 报出的落点 cfi，也是书签标记该落在的那一条。 */
  const LOCATION_CFI = 'epubcfi(/6/12!/4/2)'

  /** 一处能同时喂给书签与划线的落点，百分比固定 55%。 */
  const LOCATION: EpubRelocation = {
    start: { index: 5, cfi: LOCATION_CFI, displayed: { page: 6, total: 11 } },
    atEnd: false
  }
  const SELECTED_CFI = 'epubcfi(/6/12!/4/10)'

  /** 造一份 iframe 里的选区：位置固定，只有摘录随用例变。 */
  function contents(excerpt = '一段摘录'): EpubContents {
    const rect = { top: 100, left: 120, width: 80, height: 20 } as DOMRect

    return {
      window: {
        getSelection: () => ({
          rangeCount: 1,
          toString: () => excerpt,
          getRangeAt: () => ({ getBoundingClientRect: () => rect })
        }),
        frameElement: { getBoundingClientRect: () => rect }
      }
    }
  }

  async function renderReady(options: RenderOptions = {}): Promise<RenderResult> {
    const result = await renderReader(options)
    await waitFor(() => {
      expect(screen.getByText('阅读中')).toBeInTheDocument()
    })
    return result
  }

  /** 落一次点：书签按钮要有 epub.js 报过的位置才可用。 */
  async function relocate(epub: FakeEpub, location: EpubRelocation = LOCATION): Promise<void> {
    epub.relocate(location)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /书签$/ })).toBeEnabled()
    })
  }

  /** 一枚书签标记该有的三个参数：type 是 mark，data 里带样式表与 E2E 锚定的那个属性。 */
  function paintedMark(cfiRange: string) {
    return { type: BOOKMARK_MARK_TYPE, cfiRange, data: BOOKMARK_MARK_DATA }
  }

  function openAnnotations(): HTMLElement {
    fireEvent.click(screen.getByRole('button', { name: '注解' }))
    return screen.getByRole('complementary', { name: '注解' })
  }

  /** 读不到存档的仓储：所有动作都失败，与「没有注解」必须区分开。 */
  function unreadableRepository(): AnnotationRepository {
    const reason = new Error('存档损坏')
    return {
      load: () => Promise.resolve(),
      listByBook: () => Promise.reject(reason),
      save: () => Promise.reject(reason),
      remove: () => Promise.reject(reason),
      removeByBook: () => Promise.reject(reason)
    }
  }

  it('还没翻过页时没有落点，书签按钮一直是禁用的', async () => {
    await renderReader()

    expect(screen.getByRole('button', { name: '加书签' })).toBeDisabled()
  })

  it('翻过页之后可以加书签，再点一次就是取消', async () => {
    const { epub, annotations } = await renderReady()
    await relocate(epub)

    const toggle = screen.getByRole('button', { name: '加书签' })
    fireEvent.click(toggle)
    const remove = await screen.findByRole('button', { name: '移除书签' })
    expect(screen.queryByRole('button', { name: '加书签' })).not.toBeInTheDocument()

    openAnnotations()
    expect(screen.getByRole('button', { name: '55% 处的书签' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭注解' }))

    fireEvent.click(remove)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '加书签' })).toBeInTheDocument()
    })
    await expect(annotations.listByBook('book-1')).resolves.toEqual([])
  })

  it('打开书时把存档里的划线画回正文', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(
      createHighlight(
        { id: 'hl-1', bookId: 'book-1', cfi: SELECTED_CFI, excerpt: '一段摘录', color: 'green' },
        0
      )
    )
    const { epub } = await renderReady({ annotationRepository: repository })

    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })
    expect(epub.annotations.added[0]).toMatchObject({
      type: 'highlight',
      cfiRange: SELECTED_CFI,
      styles: { fill: '#4aa96c', 'fill-opacity': '0.35' }
    })
  })

  it('打开书时把存档里的书签画到正文页边', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(
      createBookmark(
        { id: 'bm-1', bookId: 'book-1', cfi: LOCATION_CFI, chapterHref: 'ch1.xhtml', percent: 0.55 },
        0
      )
    )
    const { epub } = await renderReady({ annotationRepository: repository })

    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })
    expect(epub.annotations.added[0]).toMatchObject(paintedMark(LOCATION_CFI))
  })

  it('加书签后在正文页边画上一枚标记', async () => {
    const { epub } = await renderReady()
    await relocate(epub)

    fireEvent.click(screen.getByRole('button', { name: '加书签' }))

    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })
    expect(epub.annotations.added[0]).toMatchObject(paintedMark(LOCATION_CFI))
  })

  it('移除书签后把页边的标记摘掉', async () => {
    const { epub } = await renderReady()
    await relocate(epub)

    fireEvent.click(screen.getByRole('button', { name: '加书签' }))
    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })

    fireEvent.click(await screen.findByRole('button', { name: '移除书签' }))

    await waitFor(() => {
      expect(epub.annotations.removed).toContainEqual({
        cfiRange: LOCATION_CFI,
        type: BOOKMARK_MARK_TYPE
      })
    })
  })

  it('划线只走 highlight 通道，不在页边上留下书签标记', async () => {
    const { epub } = await renderReady()
    await relocate(epub)

    epub.select(SELECTED_CFI, contents())
    fireEvent.click(await screen.findByRole('button', { name: HIGHLIGHT_COLOR_LABELS.green }))

    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })
    expect(epub.annotations.added.filter((call) => call.type === BOOKMARK_MARK_TYPE)).toHaveLength(0)
  })

  it('书签只走 mark 通道，不在正文里留下划线', async () => {
    const { epub } = await renderReady()
    await relocate(epub)

    fireEvent.click(screen.getByRole('button', { name: '加书签' }))

    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })
    expect(epub.annotations.added.filter((call) => call.type === 'highlight')).toHaveLength(0)
  })

  it('销毁 rendition 前先摘掉书签标记，remove 必须打在还没销毁的图层上', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(createBookmark({ id: 'bm-1', bookId: 'book-1', cfi: LOCATION_CFI }, 0))
    const { epub } = await renderReady({ annotationRepository: repository })
    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })

    cleanup()

    expect(epub.annotations.removed).toContainEqual({
      cfiRange: LOCATION_CFI,
      type: BOOKMARK_MARK_TYPE
    })
  })

  it('选中文字弹出浮条，点色块后按该颜色落盘并画到正文上', async () => {
    const { epub, annotations } = await renderReady()
    await relocate(epub)

    epub.select(SELECTED_CFI, contents())

    const toolbar = await screen.findByRole('toolbar', { name: '选中文字的操作' })
    expect(toolbar).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: HIGHLIGHT_COLOR_LABELS.green }))

    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })
    expect(epub.annotations.added[0]).toMatchObject({
      cfiRange: SELECTED_CFI,
      type: 'highlight',
      styles: { fill: highlightFill('green') }
    })
    expect(screen.queryByRole('toolbar', { name: '选中文字的操作' })).not.toBeInTheDocument()

    openAnnotations()
    expect(screen.getByRole('button', { name: '一段摘录' })).toBeInTheDocument()
    await expect(annotations.listByBook('book-1')).resolves.toMatchObject([
      {
        kind: 'highlight',
        cfi: SELECTED_CFI,
        excerpt: '一段摘录',
        percent: 0.55,
        chapterHref: '',
        color: 'green'
      }
    ])
  })

  it('同一段选区再选一次，删除划线从不可点变成可点', async () => {
    const repository = new InMemoryAnnotationRepository()
    const { epub } = await renderReady({ annotationRepository: repository })
    await relocate(epub)

    // 第一次选中：这段还没划线，删除按钮是灰的（文案恒定，只有可点状态会变）
    epub.select(SELECTED_CFI, contents())
    expect(await screen.findByRole('button', { name: '删除划线' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: HIGHLIGHT_COLOR_LABELS.yellow }))
    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })

    // 再选同一段：按钮个数与文案都不变，变的是它现在可点了
    epub.select(SELECTED_CFI, contents())
    const remove = await screen.findByRole('button', { name: '删除划线' })
    expect(remove).toBeEnabled()

    fireEvent.click(remove)

    await waitFor(() => {
      expect(epub.annotations.removed).toContainEqual({ cfiRange: SELECTED_CFI, type: 'highlight' })
    })
    await expect(repository.listByBook('book-1')).resolves.toEqual([])
  })

  it('改色是擦旧画新：同一个 cfi 上不留孤儿标记，存档里还是同一条', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(
      createHighlight(
        { id: 'hl-1', bookId: 'book-1', cfi: SELECTED_CFI, excerpt: '一段摘录', color: 'green' },
        0
      )
    )
    const { epub } = await renderReady({ annotationRepository: repository })
    await relocate(epub)
    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })

    epub.select(SELECTED_CFI, contents())
    fireEvent.click(await screen.findByRole('button', { name: HIGHLIGHT_COLOR_LABELS.blue }))

    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(2)
    })
    expect(epub.annotations.added[1]).toMatchObject({
      cfiRange: SELECTED_CFI,
      styles: { fill: highlightFill('blue') }
    })
    // 必须先擦再画：epub.js 的 marks 表按 cfi 索引，只 add 会让旧标记失去引用、再也擦不掉
    expect(epub.annotations.removed).toEqual([{ cfiRange: SELECTED_CFI, type: 'highlight' }])

    // 原地改：还是那一条，id 与 createdAt 都不变
    await expect(repository.listByBook('book-1')).resolves.toMatchObject([
      { id: 'hl-1', color: 'blue', createdAt: 0 }
    ])
    await expect(repository.listByBook('book-1')).resolves.toHaveLength(1)
  })

  it('改色写不进去时正文画回原色，并且提示失败', async () => {
    const inner = new InMemoryAnnotationRepository()
    await inner.save(
      createHighlight(
        { id: 'hl-1', bookId: 'book-1', cfi: SELECTED_CFI, excerpt: '一段摘录', color: 'green' },
        0
      )
    )
    const unwritable: AnnotationRepository = {
      load: () => inner.load(),
      listByBook: (bookId) => inner.listByBook(bookId),
      save: () => Promise.reject(new Error('磁盘满了')),
      remove: (bookId, id) => inner.remove(bookId, id),
      removeByBook: (bookId) => inner.removeByBook(bookId)
    }
    const { epub } = await renderReady({ annotationRepository: unwritable })
    await relocate(epub)
    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })

    epub.select(SELECTED_CFI, contents())
    fireEvent.click(await screen.findByRole('button', { name: HIGHLIGHT_COLOR_LABELS.blue }))

    // 第 1 次是打开书时画的绿，第 2 次是乐观改成的蓝，第 3 次是回滚后画回的绿
    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(3)
    })
    expect(epub.annotations.added[2]).toMatchObject({
      cfiRange: SELECTED_CFI,
      styles: { fill: highlightFill('green') }
    })
    expect(await screen.findByText(ANNOTATION_SAVE_FAILED_MESSAGE)).toBeInTheDocument()
  })

  it('抽屉里的划线标签带颜色名，不用点进去就知道标的是哪一种', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(
      createHighlight(
        { id: 'hl-1', bookId: 'book-1', cfi: SELECTED_CFI, excerpt: '一段摘录', color: 'blue' },
        0
      )
    )
    await renderReady({ annotationRepository: repository })

    openAnnotations()

    expect(await screen.findByText('蓝色划线')).toBeInTheDocument()
  })

  it('翻页后收起浮条，免得它飘在一处已经翻走的选区上', async () => {
    const { epub } = await renderReady()
    await relocate(epub)
    epub.select(SELECTED_CFI, contents())
    expect(await screen.findByRole('toolbar', { name: '选中文字的操作' })).toBeInTheDocument()

    epub.relocate({ ...LOCATION, start: { index: 6, cfi: 'epubcfi(/6/14!/4/2)' } })

    await waitFor(() => {
      expect(screen.queryByRole('toolbar', { name: '选中文字的操作' })).not.toBeInTheDocument()
    })
  })

  it('摘录为空或取不到选区时不弹浮条', async () => {
    const { epub } = await renderReady()
    await relocate(epub)

    epub.select(SELECTED_CFI, contents(''))
    expect(screen.queryByRole('toolbar', { name: '选中文字的操作' })).not.toBeInTheDocument()

    epub.select(SELECTED_CFI, contents('摘录'))
    expect(await screen.findByRole('toolbar', { name: '选中文字的操作' })).toBeInTheDocument()

    epub.select(SELECTED_CFI, { window: { getSelection: () => null } })
    await waitFor(() => {
      expect(screen.queryByRole('toolbar', { name: '选中文字的操作' })).not.toBeInTheDocument()
    })
  })

  it('点注解里的条目跳回原文并收起抽屉', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(
      createBookmark({ id: 'bm-1', bookId: 'book-1', cfi: 'epubcfi(/6/6!/4/2)', percent: 0.25 }, 0)
    )
    const { epub } = await renderReady({ annotationRepository: repository })

    openAnnotations()
    fireEvent.click(await screen.findByRole('button', { name: '25% 处的书签' }))

    await waitFor(() => {
      expect(epub.display).toHaveBeenLastCalledWith('epubcfi(/6/6!/4/2)')
    })
    expect(screen.queryByRole('complementary', { name: '注解' })).not.toBeInTheDocument()
  })

  it('读不到注解存档时给出文案，正文照常可读', async () => {
    const { epub } = await renderReady({ annotationRepository: unreadableRepository() })

    openAnnotations()
    expect(await screen.findByText(ANNOTATIONS_UNAVAILABLE_MESSAGE)).toBeInTheDocument()
    expect(screen.getByText('阅读中')).toBeInTheDocument()

    // 存不进就谈不上划线，浮条不该出现
    epub.relocate(LOCATION)
    epub.select(SELECTED_CFI, contents())
    expect(screen.queryByRole('toolbar', { name: '选中文字的操作' })).not.toBeInTheDocument()
  })

  it('写不进去时提示失败，并且不假装书签已经存好', async () => {
    const inner = new InMemoryAnnotationRepository()
    const unwritable: AnnotationRepository = {
      load: () => inner.load(),
      listByBook: (bookId) => inner.listByBook(bookId),
      save: () => Promise.reject(new Error('磁盘满了')),
      remove: (bookId, id) => inner.remove(bookId, id),
      removeByBook: (bookId) => inner.removeByBook(bookId)
    }
    const { epub } = await renderReady({ annotationRepository: unwritable })
    await relocate(epub)

    fireEvent.click(screen.getByRole('button', { name: '加书签' }))

    expect(await screen.findByText(ANNOTATION_SAVE_FAILED_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加书签' })).toBeInTheDocument()
  })

  it('销毁 rendition 前先把画过的标记擦干净', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(
      createHighlight({ id: 'hl-1', bookId: 'book-1', cfi: SELECTED_CFI, excerpt: '一段摘录' }, 0)
    )
    const { epub } = await renderReady({ annotationRepository: repository })
    await waitFor(() => {
      expect(epub.annotations.added).toHaveLength(1)
    })

    cleanup()

    expect(epub.annotations.removed).toContainEqual({ cfiRange: SELECTED_CFI, type: 'highlight' })
  })
})
