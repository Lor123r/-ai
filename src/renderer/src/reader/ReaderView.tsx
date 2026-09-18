import { useEffect, useRef, useState } from 'react'
import {
  normalizeExcerpt,
  type Annotation,
  type BookmarkAnnotation,
  type HighlightAnnotation,
  type HighlightColor
} from '@core/domain/annotation'
import { formatPercentLabel, locatorFromRelocation } from '@core/domain/progress'
import type { TocEntry } from '@core/domain/toc'
import { useBookContentReader } from '@renderer/data/BookContentReaderProvider'
import { useBookRepository } from '@renderer/data/BookRepositoryProvider'
import { useSettingsRepository } from '@renderer/data/SettingsRepositoryProvider'
import AnnotationDrawer from './AnnotationDrawer'
import SelectionToolbar, {
  selectionPlacement,
  type SelectionPlacement
} from './SelectionToolbar'
import SettingsPanel from './SettingsPanel'
import TocDrawer from './TocDrawer'
import {
  createBookmarkMarkSyncer,
  createHighlightSyncer,
  type BookmarkMarkSyncer,
  type HighlightSyncer
} from './annotationHighlight'
import { createEpubBook, spineLength, type EpubBook, type EpubRendition } from './createEpubBook'
import { readToc } from './epubToc'
import { toRelocationInput } from './epubRelocation'
import { createLocatorWriter, type LocatorWriter } from './locatorWriter'
import { applyReaderSettings } from './readerAppearance'
import { useBookAnnotations } from './useBookAnnotations'
import { useReaderSettings } from './useReaderSettings'

interface ReaderViewProps {
  bookId: string
  title: string
  onClose: () => void
  createBook?: (bytes: Uint8Array) => EpubBook
  now?: () => number
}

type Panel = 'none' | 'toc' | 'annotations' | 'settings'

/** 最近一次 relocated 报出来的落点。书签只能基于它生成，绝不拿存档里的旧 cfi 顶上。 */
interface ReaderPosition {
  cfi: string
  chapterHref: string
  percent: number
}

/** 当前选区，以及浮条该出现在哪。 */
interface ReaderSelection {
  cfi: string
  excerpt: string
  placement: SelectionPlacement
}

export default function ReaderView({
  bookId,
  title,
  onClose,
  createBook = createEpubBook,
  now = Date.now
}: ReaderViewProps): React.JSX.Element {
  const contentReader = useBookContentReader()
  const repository = useBookRepository()
  const settingsRepository = useSettingsRepository()
  const viewportRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<EpubRendition | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const [position, setPosition] = useState<ReaderPosition | null>(null)
  const [selection, setSelection] = useState<ReaderSelection | null>(null)
  const [activeSyncer, setActiveSyncer] = useState<HighlightSyncer | null>(null)
  const [activeBookmarkSyncer, setActiveBookmarkSyncer] = useState<BookmarkMarkSyncer | null>(null)
  const [toc, setToc] = useState<TocEntry[]>([])
  const [panel, setPanel] = useState<Panel>('none')
  const { settings, update } = useReaderSettings(settingsRepository, now)
  const {
    annotations,
    status: annotationStatus,
    error: annotationError,
    failure,
    addBookmark,
    addHighlight,
    setHighlightColor,
    removeAnnotation
  } = useBookAnnotations({ bookId, now })
  const settingsReady = settings !== null

  // 页边距交给外层容器而不是正文样式：epub.js 的排版会给自己设 body padding，
  // 在那边改会和它的分栏计算打架。容器变窄后必须显式 resize，否则排版停在旧宽度。
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !settings) return

    viewport.style.padding = `${settings.pageMargin}px`
    renditionRef.current?.resize()
  }, [settings?.pageMargin, settingsReady])

  useEffect(() => {
    let active = true
    let writer: LocatorWriter | null = null
    let syncer: HighlightSyncer | null = null
    let bookmarkSyncer: BookmarkMarkSyncer | null = null
    const viewport = viewportRef.current
    if (!contentReader || !viewport) {
      setStatus('error')
      setError('当前环境无法读取书籍正文')
      return () => {
        active = false
      }
    }

    // 等设置读完再排版：先用默认页边距渲染一次再重排会明显闪一下
    if (!settings) return

    void (async () => {
      const saved = await repository.getLocator(bookId)
      const bytes = await contentReader.read(bookId)
      if (!active) return
      if (!bytes) throw new Error('书籍文件不存在')

      // 先摆出上次读到的进度，免得还没翻页时进度条是空的
      if (saved) setPercent(saved.percent)

      const book = createBook(bytes)
      const rendition = book.renderTo(viewport, { width: '100%', height: '100%', flow: 'paginated' })
      bookRef.current = book
      renditionRef.current = rendition

      writer = createLocatorWriter({
        now,
        save: (locator) => repository.saveLocator(bookId, locator)
      })

      // 图层记账表必须和 rendition 同生共死：换书后旧账还在，新图层就会被误判成「已经画过」
      syncer = createHighlightSyncer(rendition.annotations)
      setActiveSyncer(syncer)
      bookmarkSyncer = createBookmarkMarkSyncer(rendition.annotations)
      setActiveBookmarkSyncer(bookmarkSyncer)

      rendition.on('relocated', (location) => {
        if (!active) return

        const locator = locatorFromRelocation(toRelocationInput(location, spineLength(book)), now())
        setPercent(locator.percent)
        writer?.push(locator)

        // 只认 epub.js 亲自报过的位置。存档里的 cfi 可能是空的，
        // 拿它建书签会让 core 的 requireAnnotationCfi 直接抛（设计稿 B1）
        setPosition(
          locator.cfi === null
            ? null
            : {
                cfi: locator.cfi,
                chapterHref: location.start?.href ?? '',
                percent: locator.percent
              }
        )
        // 翻页后选区已经不在屏幕上了，浮条必须收起来
        setSelection(null)
      })

      rendition.on('selected', (cfiRange, contents) => {
        if (!active) return

        // 摘录来自 iframe 里的选区，必须过一遍归一化（去控制字符、截断长度）才能进状态
        const excerpt = normalizeExcerpt(contents.window?.getSelection?.()?.toString() ?? '')
        const container = bodyRef.current
        const placement = container ? selectionPlacement(contents, container) : null
        if (excerpt === '' || placement === null) {
          setSelection(null)
          return
        }

        setSelection({ cfi: cfiRange, excerpt, placement })
      })

      await book.ready
      if (!active) return
      setToc(readToc(book))
      await rendition.display(saved?.cfi ?? undefined)
      // 打开时间只影响书架的排序，写失败不该拦住阅读
      await repository.markOpened(bookId, now()).catch(() => undefined)

      if (active) setStatus('ready')
    })().catch((caught: unknown) => {
      if (!active) return
      setStatus('error')
      setError(caught instanceof Error ? caught.message : String(caught))
    })

    return () => {
      active = false
      void writer?.dispose()
      // 先销账再拆 rendition：反过来会把 remove 打到已经销毁的图层上
      syncer?.reset()
      setActiveSyncer(null)
      bookmarkSyncer?.reset()
      setActiveBookmarkSyncer(null)
      renditionRef.current?.destroy()
      bookRef.current?.destroy()
      renditionRef.current = null
      bookRef.current = null
    }
  }, [bookId, contentReader, repository, createBook, now, settingsReady])

  /**
   * 把划线图层对齐到当前注解列表。刻意不跟 rendition：activeSyncer 只在 rendition
   * 建好时置上、销毁时置空，跟着它走就等于跟着 rendition 走，又不必再维护一个 epoch 计数器。
   */
  useEffect(() => {
    if (!activeSyncer) return

    activeSyncer.sync(
      annotations.filter((item): item is HighlightAnnotation => item.kind === 'highlight')
    )
  }, [activeSyncer, annotations])

  /**
   * 把书签标记对齐到当前注解列表。与划线一样刻意不跟 rendition —— activeBookmarkSyncer
   * 只在 rendition 建好时置上、销毁时置空。也刻意**不跟 position**：翻页不需要重画（标记
   * 落在内容坐标系里，跟着容器一起滚，可见性由视口的 overflow 裁剪），而 position 一旦进
   * 依赖，每次 relocated 都会白跑一遍全表差分。
   */
  useEffect(() => {
    if (!activeBookmarkSyncer) return

    activeBookmarkSyncer.sync(
      annotations.filter((item): item is BookmarkAnnotation => item.kind === 'bookmark')
    )
  }, [activeBookmarkSyncer, annotations])

  // 设置变化时重写正文样式；override 会被 epub.js 记下来，新章节也会自动套用
  useEffect(() => {
    const rendition = renditionRef.current
    if (!settings || !rendition?.themes || status !== 'ready') return
    applyReaderSettings(rendition.themes, settings)
  }, [settings, status])

  function fail(caught: unknown): void {
    setError(caught instanceof Error ? caught.message : String(caught))
  }

  function move(direction: 'next' | 'prev'): void {
    const rendition = renditionRef.current
    if (!rendition || status !== 'ready') return
    void rendition[direction]().then(() => setError(null), fail)
  }

  function goTo(entry: TocEntry): void {
    const rendition = renditionRef.current
    setPanel('none')
    if (!rendition || status !== 'ready') return
    void rendition.display(entry.href).then(() => setError(null), fail)
  }

  function goToAnnotation(annotation: Annotation): void {
    const rendition = renditionRef.current
    setPanel('none')
    if (!rendition || status !== 'ready') return
    void rendition.display(annotation.cfi).then(() => setError(null), fail)
  }

  // 书签是 toggle：同一处再点一次就是取消。同一个 cfi 上出现两条标
  // 会让 epub.js 的 marks 表被覆盖，留下一枚清不掉的孤儿标记。
  const bookmarkAt =
    position === null
      ? undefined
      : annotations.find((item) => item.kind === 'bookmark' && item.cfi === position.cfi)

  // 划线同理：同 cfi 已有划线时浮条改成「改色 / 删除」，不做「同一段划两次」。
  // 用类型谓词收窄成 HighlightAnnotation，浮条才拿得到 color。
  const highlightAt =
    selection === null
      ? undefined
      : annotations.find(
          (item): item is HighlightAnnotation =>
            item.kind === 'highlight' && item.cfi === selection.cfi
        )

  const canAnnotate = status === 'ready' && annotationStatus === 'ready'

  function toggleBookmark(): void {
    if (!position || !canAnnotate) return

    if (bookmarkAt) {
      void removeAnnotation(bookmarkAt)
      return
    }

    void addBookmark({ cfi: position.cfi, chapterHref: position.chapterHref, percent: position.percent })
  }

  /**
   * 浮动条上点了某个色块：选区上还没有划线就地新建，已有就原地改色。
   *
   * 两个分支都不需要按 cfi 先删再建 —— 改色走的是同一条注解（id 不变），
   * 图层那边按 id 记账、发现配色变了才会撤旧画新，不会留下孤儿 mark。
   * 点到的正好是当前颜色时由 setHighlightColor 提前返回，一次 IPC 都不发。
   */
  function pickHighlightColor(color: HighlightColor): void {
    if (selection === null || !canAnnotate) return

    const { cfi, excerpt } = selection
    const existing = highlightAt
    setSelection(null)

    if (existing) {
      void setHighlightColor(existing, color)
      return
    }

    // percent 用的是最近一次 relocated 的值，对划线只是近似：epub.js 的
    // selected 事件只给 cfi，不给进度。列表里的百分比因此可能和正文差一点。
    void addHighlight({
      cfi,
      excerpt,
      color,
      percent: position?.percent,
      chapterHref: position?.chapterHref
    })
  }

  function removeHighlight(): void {
    if (selection === null || !canAnnotate) return

    const existing = highlightAt
    setSelection(null)
    if (!existing) return

    void removeAnnotation(existing)
  }

  const theme = settings?.theme ?? 'day'

  return (
    <section className="reader" aria-label={`正在阅读《${title}》`} data-theme={theme}>
      <header className="reader__header">
        <button type="button" onClick={onClose}>
          返回书架
        </button>
        <button
          type="button"
          aria-expanded={panel === 'toc'}
          disabled={status !== 'ready'}
          onClick={() => setPanel(panel === 'toc' ? 'none' : 'toc')}
        >
          目录
        </button>
        <button
          type="button"
          aria-expanded={panel === 'annotations'}
          onClick={() => setPanel(panel === 'annotations' ? 'none' : 'annotations')}
        >
          注解
        </button>
        <button type="button" disabled={!canAnnotate || position === null} onClick={toggleBookmark}>
          {bookmarkAt ? '移除书签' : '加书签'}
        </button>
        <button
          type="button"
          aria-expanded={panel === 'settings'}
          disabled={status !== 'ready'}
          onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
        >
          设置
        </button>
        <h1>{title}</h1>
        <span className="reader__status">
          {status === 'loading' ? '正在打开…' : status === 'ready' ? '阅读中' : '打开失败'}
        </span>
        {percent !== null ? (
          <span className="reader__percent" aria-label="阅读进度">
            {formatPercentLabel(percent)}
          </span>
        ) : null}
      </header>
      {error ? <p className="reader__error">无法打开本书：{error}</p> : null}
      {failure !== null ? <p className="reader__annotation-error">{failure}</p> : null}
      <div ref={bodyRef} className="reader__body">
        <div ref={viewportRef} className="reader__viewport" data-status={status} />
        {selection !== null && annotationStatus === 'ready' ? (
          <SelectionToolbar
            placement={selection.placement}
            activeColor={highlightAt?.color ?? null}
            onPickColor={pickHighlightColor}
            onRemoveHighlight={removeHighlight}
            onDismiss={() => setSelection(null)}
          />
        ) : null}
        {panel === 'toc' ? (
          <TocDrawer entries={toc} onSelect={goTo} onClose={() => setPanel('none')} />
        ) : null}
        {panel === 'annotations' ? (
          <AnnotationDrawer
            annotations={annotations}
            status={annotationStatus}
            error={annotationError}
            onSelect={goToAnnotation}
            onRemove={removeAnnotation}
            onClose={() => setPanel('none')}
          />
        ) : null}
        {panel === 'settings' && settings ? (
          <SettingsPanel settings={settings} onChange={update} onClose={() => setPanel('none')} />
        ) : null}
      </div>
      <footer className="reader__controls">
        <button type="button" onClick={() => move('prev')} disabled={status !== 'ready'}>
          上一页
        </button>
        <button type="button" onClick={() => move('next')} disabled={status !== 'ready'}>
          下一页
        </button>
      </footer>
    </section>
  )
}
