import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { locatorFromRelocation, type ReadingLocator } from '@core/domain/progress'
import { MAX_TEXT_BYTES, blockPageFromLocator, splitTextIntoBlocks } from '@core/domain/textBook'
import { useBookContentReader } from '@renderer/data/BookContentReaderProvider'
import { useBookRepository } from '@renderer/data/BookRepositoryProvider'
import { useSettingsRepository } from '@renderer/data/SettingsRepositoryProvider'
import AnnotationDrawer from './AnnotationDrawer'
import ReaderChrome, { type ReaderPanel } from './ReaderChrome'
import SettingsPanel from './SettingsPanel'
import { decodeTextBytes } from './decodeText'
import { createLocatorWriter, type LocatorWriter } from './locatorWriter'
import { readerAppearanceStyle, type ReaderAppearanceStyle } from './readerAppearance'
import {
  clampPage,
  columnGap,
  columnStep,
  offsetForPage,
  totalPagesFromScroll
} from './textPagination'
import { useReaderSettings } from './useReaderSettings'

interface TxtReaderViewProps {
  bookId: string
  title: string
  onClose: () => void
  now?: () => number
}

/**
 * 量出来的排版结果。columnWidth 既是量出来的事实，也是回写进 CSS 的输入：
 * 首帧还不认识宽度时按单栏普通流先画着（columnWidth 为 0），量到宽度后再交给多栏。
 */
interface TextLayout {
  columnWidth: number
  step: number
  totalPages: number
}

const INITIAL_LAYOUT: TextLayout = { columnWidth: 0, step: 1, totalPages: 1 }

/** notice 有值时抽屉里没有可点的东西，这些回调到不了；给个占位，免得在 JSX 里堆箭头函数。 */
const unreachable = (): void => undefined

/** TXT 的注解说明。不写「敬请期待」：说清为什么没有，比给一个空列表诚实。 */
export const TXT_ANNOTATION_NOTICE =
  'TXT 书暂不支持注解：没有 cfi 这类稳定锚点，标注没法准确定位回原文。'

/**
 * TXT 正文。
 *
 * 与 EPUB 后端共用 ReaderChrome 的外壳，但正文这块没有任何共同点：没有 cfi、没有注解
 * 图层，分页也只能靠 CSS 多栏 + 量 scrollWidth 自己算。把两端强行抽成同一个接口，换来的
 * 是一堆「EPUB 有、TXT 没有」的可选字段，所以这里宁可各写各的。
 */
export default function TxtReaderView({
  bookId,
  title,
  onClose,
  now = Date.now
}: TxtReaderViewProps): React.JSX.Element {
  const contentReader = useBookContentReader()
  const repository = useBookRepository()
  const settingsRepository = useSettingsRepository()
  const flowRef = useRef<HTMLDivElement>(null)
  const writerRef = useRef<LocatorWriter | null>(null)
  /** 打开时读到的存档进度；等排版量出总页数后被反解使用，用完即弃。 */
  const pendingRestore = useRef<ReadingLocator | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<string[]>([])
  const [blockIndex, setBlockIndex] = useState(0)
  const [page, setPage] = useState(1)
  const [layout, setLayout] = useState<TextLayout>(INITIAL_LAYOUT)
  const [percent, setPercent] = useState<number | null>(null)
  const [panel, setPanel] = useState<ReaderPanel>('none')
  const { settings, update } = useReaderSettings(settingsRepository, now)
  const settingsReady = settings !== null
  const pageMargin = settings?.pageMargin ?? 0
  const theme = settings?.theme ?? 'day'

  useEffect(() => {
    let active = true
    if (!contentReader) {
      setStatus('error')
      setError('当前环境无法读取书籍正文')
      return () => {
        active = false
      }
    }

    // 与 EPUB 同理：先等设置读完，免得按默认字号排一遍再重排
    if (!settings) return

    void (async () => {
      const bytes = await contentReader.read(bookId)
      if (!active) return
      if (!bytes) throw new Error('书籍文件不存在')
      if (bytes.length > MAX_TEXT_BYTES) {
        throw new Error(`TXT 文件过大（超过 ${MAX_TEXT_BYTES / 1024 / 1024} MB），暂不支持打开`)
      }

      const parsed = splitTextIntoBlocks(decodeTextBytes(bytes))
      if (parsed.length === 0) throw new Error('文件里没有可显示的文本')

      const saved = await repository.getLocator(bookId)
      if (!active) return

      writerRef.current = createLocatorWriter({
        now,
        save: (locator) => repository.saveLocator(bookId, locator)
      })

      // 先摆上存档里的进度，免得还没翻页时进度是空的
      if (saved) setPercent(saved.percent)
      // TXT 没有 cfi，重开只能靠 chapterIndex 落到块首；块内页码要等量出总页数后再反解
      pendingRestore.current = saved
      setBlocks(parsed)
      setBlockIndex(Math.min(saved?.chapterIndex ?? 0, parsed.length - 1))
      setStatus('ready')
      // 打开时间只影响书架的排序，写失败不该拦住阅读
      await repository.markOpened(bookId, now()).catch(() => undefined)
    })().catch((caught: unknown) => {
      if (!active) return
      setStatus('error')
      setError(caught instanceof Error ? caught.message : String(caught))
    })

    return () => {
      active = false
      pendingRestore.current = null
      void writerRef.current?.dispose()
      writerRef.current = null
    }
  }, [bookId, contentReader, repository, now, settingsReady])

  /**
   * 量一栏有多宽、正文一共溢出成几栏，顺带把存档里的进度落到页上。
   *
   * 放在 layout effect 里：量完要立刻回写 columnWidth，晚一帧就会先按单栏闪一下。
   * 依赖里带 columnWidth 是为了收敛 —— 首帧 CSS 还是单栏普通流，量不出真实的总栏数，
   * 回写宽度后必须再量一次；第二次量出来的 columnWidth 不变，状态不动，循环自然停。
   *
   * 续读重建也在这里做，而不是另起一个 effect：布局状态要到下一次渲染才更新，
   * 在别处读 layout.totalPages 会拿到首帧那个恒为 1 的旧值，反解只会得到块首。
   * 同理，首帧量的是单栏普通流（--reader-column-width 还是 auto），不能用它反解。
   */
  useLayoutEffect(() => {
    const flow = flowRef.current
    if (flow === null || blocks.length === 0) return

    const measure = (): void => {
      const element = flowRef.current
      if (element === null) return

      const columnWidth = Math.max(1, Math.round(element.clientWidth))
      const gap = columnGap(pageMargin)
      const step = columnStep(columnWidth, pageMargin)
      const totalPages = totalPagesFromScroll(element.scrollWidth, step, gap)

      const target = pendingRestore.current
      if (target !== null && layout.columnWidth > 0) {
        // 只在「打开时落的那一块」上反解：用户已经翻到别处就别再把他拽回去
        pendingRestore.current = null
        if (target.chapterIndex === blockIndex) {
          setPage(blockPageFromLocator(target, blocks.length, totalPages))
        }
      }

      setLayout((previous) =>
        previous.columnWidth === columnWidth &&
        previous.step === step &&
        previous.totalPages === totalPages
          ? previous
          : { columnWidth, step, totalPages }
      )
      // 排在反解之后：改字号会让总页数变少，反解出来的页码也得过这道夹取
      setPage((current) => clampPage(current, totalPages))
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [blocks, blockIndex, layout.columnWidth, pageMargin])

  // 翻页、换块、改字号都会改变落点，统一在这里算进度并交给节流器落盘
  useEffect(() => {
    if (status !== 'ready' || blocks.length === 0) return

    const locator = locatorFromRelocation(
      {
        cfi: null,
        chapterIndex: blockIndex,
        page,
        totalPages: layout.totalPages,
        spineCount: blocks.length,
        atEnd: blockIndex >= blocks.length - 1 && page >= layout.totalPages
      },
      now()
    )
    setPercent(locator.percent)
    writerRef.current?.push(locator)
  }, [status, blocks.length, blockIndex, page, layout.totalPages, now])

  function move(direction: 'next' | 'prev'): void {
    if (status !== 'ready') return

    if (direction === 'next') {
      if (page < layout.totalPages) {
        setPage(page + 1)
        return
      }
      if (blockIndex + 1 < blocks.length) {
        setBlockIndex(blockIndex + 1)
        setPage(1)
      }
      return
    }

    if (page > 1) {
      setPage(page - 1)
      return
    }
    if (blockIndex > 0) {
      // 往回翻只能落到上一块的块首：那一块有多少页要等它排完才知道
      setBlockIndex(blockIndex - 1)
      setPage(1)
    }
  }

  const viewportStyle: ReaderAppearanceStyle = {
    ...(settings ? readerAppearanceStyle(settings) : {}),
    '--reader-column-width': layout.columnWidth > 0 ? `${layout.columnWidth}px` : 'auto',
    '--reader-column-gap': `${columnGap(pageMargin)}px`
  }
  const offset = offsetForPage(page, layout.step, layout.totalPages)

  return (
    <ReaderChrome
      title={title}
      theme={theme}
      status={status}
      percent={percent}
      loadError={error}
      panel={panel}
      onPanelChange={setPanel}
      onClose={onClose}
      tocDisabled
      onMove={move}
    >
      <div
        className="reader__viewport reader__viewport--text"
        data-status={status}
        style={viewportStyle}
      >
        <div
          ref={flowRef}
          className="txt-reader"
          style={{ transform: `translateX(${offset}px)` }}
        >
          {blocks.length > 0 ? (
            <p className="txt-reader__block">{blocks[blockIndex] ?? ''}</p>
          ) : null}
        </div>
      </div>
      {panel === 'annotations' ? (
        <AnnotationDrawer
          annotations={[]}
          status="ready"
          error={null}
          canTransfer={false}
          transferResult={null}
          notice={TXT_ANNOTATION_NOTICE}
          onExport={unreachable}
          onImport={unreachable}
          onSelect={unreachable}
          onRemove={unreachable}
          onClose={() => setPanel('none')}
        />
      ) : null}
      {panel === 'settings' && settings ? (
        <SettingsPanel settings={settings} onChange={update} onClose={() => setPanel('none')} />
      ) : null}
    </ReaderChrome>
  )
}
