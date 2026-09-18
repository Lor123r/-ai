import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocator } from '@core/domain/progress'
import { MAX_TEXT_BYTES } from '@core/domain/textBook'
import type { BookRepository } from '@core/ports/bookRepository'
import { InMemorySettingsRepository } from '@core/adapters/inMemorySettingsRepository'
import { BookContentReaderProvider } from '@renderer/data/BookContentReaderProvider'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import { SettingsRepositoryProvider } from '@renderer/data/SettingsRepositoryProvider'
import TxtReaderView, {
  TXT_ANNOTATION_NOTICE,
  TXT_ENCODING_NOTICE
} from '@renderer/reader/TxtReaderView'
import { columnGap, columnStep } from '@renderer/reader/textPagination'
import { seedRepository } from '../support/fakeRepository'

/**
 * jsdom 里 clientWidth / scrollWidth 恒为 0，分页量不出任何东西。
 * 这里把两个只读属性接管成可写的探针，让「一栏多宽、一共几栏」可控，
 * 才能真正测到量宽度那一段 —— 否则全篇只能断言「文本渲染出来了」。
 *
 * autoFlow 打开后 scrollWidth 照真实浏览器来：--reader-column-width 还是 auto 时
 * 正文是单栏普通流，量出来就等于一栏宽；等宽度回写进 CSS 才是多栏的总宽。
 */
const metrics = { clientWidth: 0, scrollWidth: 0, autoFlow: false }

beforeEach(() => {
  metrics.clientWidth = 0
  metrics.scrollWidth = 0
  metrics.autoFlow = false
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => metrics.clientWidth
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (metrics.autoFlow && columnWidthVariable(this) === 'auto') return metrics.clientWidth
      return metrics.scrollWidth
    }
  })
})

/** 栏宽变量挂在视口上，正文层是它的子节点。 */
function columnWidthVariable(element: HTMLElement): string {
  return element.parentElement?.style.getPropertyValue('--reader-column-width') ?? ''
}

afterEach(() => {
  cleanup()
})

const COLUMN_WIDTH = 800
const PAGE_MARGIN = 32
const GAP = columnGap(PAGE_MARGIN)
const STEP = columnStep(COLUMN_WIDTH, PAGE_MARGIN)

/** 让正文正好排成 pages 栏：n 栏宽 + (n-1) 个栏间距。 */
function layoutColumns(pages: number, width: number = COLUMN_WIDTH): void {
  metrics.clientWidth = width
  metrics.scrollWidth = pages * width + (pages - 1) * GAP
}

interface RenderOptions {
  text?: string
  bytes?: Uint8Array | null
  title?: string
  onClose?: () => void
  repository?: BookRepository
  reader?: { read: (bookId: string) => Promise<Uint8Array | null> } | null
  now?: () => number
}

async function renderTxt(options: RenderOptions = {}): Promise<{
  repository: BookRepository
  onClose: ReturnType<typeof vi.fn>
}> {
  const onClose = vi.fn(options.onClose)
  const repository = options.repository ?? (await seedRepository()).repository
  const reader =
    options.reader === undefined
      ? {
          read: async () =>
            options.bytes === undefined
              ? new TextEncoder().encode(options.text ?? '第一章\n\n第二章')
              : options.bytes
        }
      : options.reader

  render(
    <BookRepositoryProvider repository={repository}>
      <BookContentReaderProvider reader={reader}>
        <SettingsRepositoryProvider repository={new InMemorySettingsRepository()}>
          <TxtReaderView
            bookId="book-1"
            title={options.title ?? '三体'}
            onClose={onClose}
            now={options.now}
          />
        </SettingsRepositoryProvider>
      </BookContentReaderProvider>
    </BookRepositoryProvider>
  )

  return { repository, onClose }
}

async function ready(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByText('阅读中')).toBeInTheDocument()
  })
  return screen.getByLabelText('正在阅读《三体》')
}

function flow(): HTMLElement {
  const element = document.querySelector('.txt-reader')
  if (!(element instanceof HTMLElement)) throw new Error('没有渲染出正文容器')
  return element
}

function viewport(): HTMLElement {
  const element = document.querySelector('.reader__viewport--text')
  if (!(element instanceof HTMLElement)) throw new Error('没有渲染出 TXT 视口')
  return element
}

describe('TxtReaderView', () => {
  it('打开时先显示加载态，随后把正文渲染出来', async () => {
    await renderTxt({ text: '第一章\n\n第二章' })

    expect(screen.getByText('正在打开…')).toBeInTheDocument()

    await ready()
    expect(screen.getByText('第一章')).toBeInTheDocument()
    // 一次只渲染一个块：TXT 的「块」就是章节，跨块由翻页负责
    expect(screen.queryByText('第二章')).not.toBeInTheDocument()
  })

  it('正文容器用 TXT 专属类名，EPUB 的多栏样式不会误伤', async () => {
    await renderTxt({ text: '第一章' })
    await ready()

    expect(viewport()).toHaveAttribute('data-status', 'ready')
  })

  it('目录按钮按认出来的目录项决定可用性，TXT 不再是永远置灰', async () => {
    await renderTxt({ text: '第一章\n\n第二章' })
    await ready()

    expect(screen.getByRole('button', { name: '目录' })).toBeEnabled()
  })

  it('打开成功后会更新最后打开时间', async () => {
    const { repository } = await seedRepository()
    const openedAt = 1_800_000_000_000
    await renderTxt({ text: '第一章', repository, now: () => openedAt })
    await ready()

    await expect(repository.get('book-1')).resolves.toMatchObject({ lastOpenedAt: openedAt })
  })

  it('文件不存在时报错而不是空白', async () => {
    await renderTxt({ bytes: null })

    await waitFor(() => {
      expect(screen.getByText('打开失败')).toBeInTheDocument()
    })
    expect(screen.getByText(/书籍文件不存在/)).toBeInTheDocument()
  })

  it('空文件给出「没有可显示的文本」，不渲染空的正文块', async () => {
    await renderTxt({ text: '   \n\n \t ' })

    await waitFor(() => {
      expect(screen.getByText(/文件里没有可显示的文本/)).toBeInTheDocument()
    })
    expect(document.querySelector('.txt-reader__block')).not.toBeInTheDocument()
  })

  it('超过字节上限时不解码，直接提示文件过大', async () => {
    // 只分配不填充：写满 16MB 会让用例慢到没意义
    await renderTxt({ bytes: new Uint8Array(MAX_TEXT_BYTES + 1) })

    await waitFor(() => {
      expect(screen.getByText(/TXT 文件过大（超过 16 MB）/)).toBeInTheDocument()
    })
    expect(document.querySelector('.txt-reader__block')).not.toBeInTheDocument()
  })
})

describe('TxtReaderView 分页与进度', () => {
  it('渲染后按量出来的宽度把正文移到第一栏', async () => {
    layoutColumns(3)
    await renderTxt({ text: '第一章' })
    await ready()

    await waitFor(() => {
      expect(flow().style.transform).toBe('translateX(0px)')
    })
    expect(viewport().style.getPropertyValue('--reader-column-width')).toBe(`${COLUMN_WIDTH}px`)
    expect(viewport().style.getPropertyValue('--reader-column-gap')).toBe(`${GAP}px`)
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('0%')
  })

  it('下一页按步进平移，进度跟着涨', async () => {
    layoutColumns(3)
    await renderTxt({ text: '第一章' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(flow().style.transform).toBe(`translateX(${-STEP}px)`)
    })
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('50%')

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(flow().style.transform).toBe(`translateX(${-2 * STEP}px)`)
    })
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('100%')
  })

  it('上一页回到上一栏，第一栏时停在原处', async () => {
    layoutColumns(3)
    await renderTxt({ text: '第一章' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(flow().style.transform).toBe('translateX(0px)')

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(screen.getByLabelText('阅读进度')).toHaveTextContent('100%')
    })

    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => {
      expect(flow().style.transform).toBe(`translateX(${-STEP}px)`)
    })
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('50%')
  })

  it('本块翻到底才换下一块，换块后回到块首', async () => {
    layoutColumns(4)
    await renderTxt({ text: '第一章\n\n第二章' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => {
      expect(flow().style.transform).toBe(`translateX(${-STEP}px)`)
    })
    // 块内第 2 栏：整本书 2 块，进度只走了一小块里的三分之一
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('17%')

    // 再点 3 次才把第一块翻完、跨到第二块
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    }

    await waitFor(() => {
      expect(screen.getByText('第二章')).toBeInTheDocument()
    })
    expect(flow().style.transform).toBe('translateX(0px)')
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('50%')
  })

  it('翻到最后一页就是 100%', async () => {
    layoutColumns(2)
    await renderTxt({ text: '第一章\n\n第二章' })
    await ready()

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    }

    await waitFor(() => {
      expect(screen.getByLabelText('阅读进度')).toHaveTextContent('100%')
    })
  })

  it('量出的进度会落盘，且 CFI 为 null', async () => {
    layoutColumns(2)
    const { repository, book } = await seedRepository()
    const spy = vi.spyOn(repository, 'saveLocator')
    await renderTxt({ text: '第一章\n\n第二章', repository })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(
        book.id,
        expect.objectContaining({ cfi: null, chapterIndex: 0 })
      )
    })
  })

  it('有存档时从存档的块打开，并先把上次的百分比显示出来', async () => {
    layoutColumns(2)
    const { repository, book } = await seedRepository()
    await repository.saveLocator(
      book.id,
      createLocator({ cfi: null, percent: 0.5, chapterIndex: 1 }, 1)
    )
    await renderTxt({ text: '第一章\n\n第二章', repository })
    await ready()

    expect(screen.getByText('第二章')).toBeInTheDocument()
    // 存档落在第二块的首栏：反解出来就是第一栏，进度不该比存档值小
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('50%')
  })

  it('首帧只量得出单栏时不用它反解，等真实栏数出来再落回存档那一栏', async () => {
    // 真实浏览器里第一帧 --reader-column-width 还是 auto，正文按单栏普通流排版，
    // 量出来的总栏数恒为 1；拿它反解存档只会退回块首
    const totalPages = 5
    const blockCount = 4
    const percent = (0 + (4 - 1) / (totalPages - 1)) / blockCount
    metrics.autoFlow = true
    layoutColumns(totalPages)
    const { repository, book } = await seedRepository()
    await repository.saveLocator(book.id, createLocator({ cfi: null, percent, chapterIndex: 0 }, 1))
    await renderTxt({ text: '第一章\n\n第二章\n\n第三章\n\n第四章', repository })
    await ready()

    await waitFor(() => {
      expect(flow().style.transform).toBe(`translateX(${-3 * STEP}px)`)
    })
    // 进度是全书的百分比，不是块内百分比：0.1875 四舍五入到 19%
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('19%')
    expect(screen.getByLabelText('阅读进度')).not.toHaveTextContent('0%')
  })

  it('存档的块序号越界时夹到最后一页块上', async () => {
    layoutColumns(1)
    const { repository, book } = await seedRepository()
    await repository.saveLocator(
      book.id,
      createLocator({ cfi: null, percent: 0.9, chapterIndex: 99 }, 1)
    )
    await renderTxt({ text: '第一章\n\n第二章', repository })
    await ready()

    expect(screen.getByText('第二章')).toBeInTheDocument()
  })

  it('还没排版完成时翻页按钮不可用', async () => {
    await renderTxt({ text: '第一章' })

    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()

    await ready()
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled()
  })
})

describe('TxtReaderView 目录', () => {
  it('抽屉里列出认出来的章节，而不是那句「这本书没有提供目录」', async () => {
    await renderTxt({ text: '第一章 初见\n\n正文\n\n第二章 离别' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '目录' }))

    expect(screen.getByRole('button', { name: '第一章 初见' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '第二章 离别' })).toBeInTheDocument()
    expect(screen.queryByText('这本书没有提供目录')).not.toBeInTheDocument()
  })

  it('选中目录项后跳到对应的块，抽屉自动收起', async () => {
    layoutColumns(2)
    await renderTxt({ text: '第一章\n\n第二章' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '目录' }))
    fireEvent.click(screen.getByRole('button', { name: '第二章' }))

    await waitFor(() => {
      expect(document.querySelector('.txt-reader__block')?.textContent).toBe('第二章')
    })
    expect(screen.queryByRole('button', { name: '第二章' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('50%')
  })

  it('同一块里的第二个标题按块内偏移落到块中间，不是一律回块首', async () => {
    // 章节之间只换行不空行 → 整段就是一个块，两个标题同属一块
    const text = `第一章 初见\n${'正文'.repeat(50)}\n第二章 离别\n正文`
    layoutColumns(4)
    await renderTxt({ text })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '目录' }))
    fireEvent.click(screen.getByRole('button', { name: '第二章 离别' }))

    // 标题落在块内 108/117 处，按占比摊到 4 栏就是第 4 栏
    await waitFor(() => {
      expect(flow().style.transform).toBe(`translateX(${-3 * STEP}px)`)
    })
  })

  it('一个标题都认不出来时按块首列，至少还能跳段落', async () => {
    layoutColumns(2)
    await renderTxt({ text: '甲段落\n\n乙段落' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '目录' }))
    fireEvent.click(screen.getByRole('button', { name: '乙段落' }))

    await waitFor(() => {
      expect(document.querySelector('.txt-reader__block')?.textContent).toBe('乙段落')
    })
  })

  it('再点一次目录就收起抽屉', async () => {
    await renderTxt({ text: '第一章\n\n第二章' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '目录' }))
    expect(screen.getByRole('button', { name: '关闭目录' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '目录' }))
    expect(screen.queryByRole('button', { name: '关闭目录' })).not.toBeInTheDocument()
  })

  it('还没打开成功时目录按钮不可用', async () => {
    await renderTxt({ bytes: null })

    await waitFor(() => {
      expect(screen.getByText('打开失败')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '目录' })).toBeDisabled()
  })
})

describe('TxtReaderView 编码提示', () => {
  it('正常 UTF-8 不弹提示', async () => {
    await renderTxt({ text: '第一章' })
    await ready()

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('坏字节解码后提示编码可能不对，但正文照旧渲染', async () => {
    await renderTxt({ bytes: new Uint8Array([0xff, 0xff, 0x0a, 0x0a, 0xff, 0xfe]) })
    await ready()

    expect(screen.getByRole('status')).toHaveTextContent(TXT_ENCODING_NOTICE)
    expect(document.querySelector('.txt-reader__block')).not.toBeNull()
  })

  it('GBK 文件能正常解开，不该被当成编码可疑', async () => {
    // 「中文」的 GBK 字节
    await renderTxt({ bytes: new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]) })
    await ready()

    expect(screen.getByText('中文')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('打开失败时不留下上一次的提示', async () => {
    await renderTxt({ bytes: null })

    await waitFor(() => {
      expect(screen.getByText('打开失败')).toBeInTheDocument()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('TxtReaderView 注解', () => {
  it('打开注解抽屉只给一句说明，没有可点的列表与导出导入', async () => {
    await renderTxt({ text: '第一章' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '注解' }))

    expect(screen.getByText(TXT_ANNOTATION_NOTICE)).toBeInTheDocument()
    expect(screen.queryByText('还没有书签或划线')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导出注解' })).not.toBeInTheDocument()
    expect(document.querySelector('.annotation-list')).not.toBeInTheDocument()
  })

  it('再点一次注解就收起抽屉', async () => {
    await renderTxt({ text: '第一章' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '注解' }))
    expect(screen.getByText(TXT_ANNOTATION_NOTICE)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '注解' }))
    expect(screen.queryByText(TXT_ANNOTATION_NOTICE)).not.toBeInTheDocument()
  })

  it('TXT 没有加书签的入口', async () => {
    await renderTxt({ text: '第一章' })
    await ready()

    expect(screen.queryByRole('button', { name: '加书签' })).not.toBeInTheDocument()
  })
})

describe('TxtReaderView 错误与外壳', () => {
  it('没有正文读取能力时报错', async () => {
    await renderTxt({ reader: null })

    await waitFor(() => {
      expect(screen.getByText(/当前环境无法读取书籍正文/)).toBeInTheDocument()
    })
  })

  it('没有正文读取能力时设置按钮也不可用', async () => {
    await renderTxt({ reader: null })

    await waitFor(() => {
      expect(screen.getByText('打开失败')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '设置' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })

  it('返回书架交给外部处理', async () => {
    const { onClose } = await renderTxt({ text: '第一章', title: '三体' })
    await ready()

    fireEvent.click(screen.getByRole('button', { name: '返回书架' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('标题进外壳的可访问名', async () => {
    await renderTxt({ text: '第一章', title: '球状闪电' })
    await waitFor(() => {
      expect(screen.getByLabelText('正在阅读《球状闪电》')).toBeInTheDocument()
    })
  })
})
