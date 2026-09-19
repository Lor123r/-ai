import { useEffect, useRef, useState } from 'react'
import {
  normalizeExcerpt,
  type Annotation,
  type BookmarkAnnotation,
  type HighlightAnnotation,
  type HighlightColor
} from '@core/domain/annotation'
import { locatorFromRelocation } from '@core/domain/progress'
import type { TocEntry } from '@core/domain/toc'
import { useBookContentReader } from '@renderer/data/BookContentReaderProvider'
import { useBookRepository } from '@renderer/data/BookRepositoryProvider'
import { useSettingsRepository } from '@renderer/data/SettingsRepositoryProvider'
import AnnotationDrawer from './AnnotationDrawer'
import ReaderChrome, { type ReaderPanel } from './ReaderChrome'
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

interface EpubReaderViewProps {
  bookId: string
  title: string
  onClose: () => void
  createBook?: (bytes: Uint8Array) => EpubBook
  now?: () => number
}

/**
 * 最近一次 relocated 报出来的落点。书签只能基于它生成，绝不拿存档里的旧 cfi 顶上。
 *
 * `page` / `totalPages` / `spineCount` 是给书签判据用的：改字号后同一个字符的 cfi
 * 会变，但「还在这一页」这件事不变，所以判据落在页上而不是 cfi 上（见 isOnCurrentPage）。
 */
interface ReaderPosition {
  cfi: string
  chapterHref: string
  percent: number
  chapterIndex: number | null
  /** 全书章节数。算「一页占全书多少」要用它，缺了就只能退化成整章。 */
  spineCount: number | null
  page: number | null
  totalPages: number | null
}

/** 当前选区，以及浮条该出现在哪。 */
interface ReaderSelection {
  cfi: string
  excerpt: string
  placement: SelectionPlacement
}

/**
 * 一条书签是不是落在当前这一页上。
 *
 * 两道闸：章节 href 相等，且书签的百分比落在当前页的百分比区间里。
 *
 * 为什么不能只比 cfi：改字号后同一个字符的 cfi 会变，精确相等必然落空。
 * 为什么不能只比 href：同一章里可以有好几枚书签，按章判会让第二枚加不出来。
 * 为什么 href 也要比：percent 是浮点数、又被 clampPercent 夹到 [0,1]，
 * 首尾两页的边界容易误判，href 相等这道闸把跨章误判直接归零。
 *
 * href 两边都为空时算相等：epub.js 偶尔不报 href，这时 percent 区间是唯一的判据，
 * 比直接判「不在当前页」更贴近用户看到的东西。
 */
function isOnCurrentPage(bookmark: BookmarkAnnotation, position: ReaderPosition): boolean {
  if (bookmark.chapterHref !== position.chapterHref) return false

  const { start, end } = currentPageRange(position)
  return bookmark.percent >= start && bookmark.percent < end
}

/**
 * 当前页的百分比区间 `[start, end)`。
 *
 * `start` 就是 relocated 报出来的 percent（当前页起点）。一页占全书的比例是
 * `1 / (spineCount * totalPages)`，所以 `end = start + 1 / (spineCount * totalPages)`。
 *
 * 页号或章节数缺失时退化成整章终点（`end` 落在下一章起点）—— 判据随之放宽成
 * 「本章内有没有书签」，比原来的精确 cfi 相等宽松，但 percent 区间仍在起作用，
 * 不会整章都算已加。
 */
function currentPageRange(position: ReaderPosition): { start: number; end: number } {
  const start = position.percent
  const { chapterIndex, spineCount, page, totalPages } = position

  if (chapterIndex === null || spineCount === null || spineCount <= 0) {
    return { start, end: start }
  }

  const chapterSpan = 1 / spineCount
  const end =
    page === null || totalPages === null || totalPages <= 0
      ? (chapterIndex + 1) * chapterSpan
      : start + chapterSpan / totalPages

  return { start, end: Math.min(end, 1) }
}

export default function EpubReaderView({
  bookId,
  title,
  onClose,
  createBook = createEpubBook,
  now = Date.now
}: EpubReaderViewProps): React.JSX.Element {
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
  const [panel, setPanel] = useState<ReaderPanel>('none')
  const { settings, update } = useReaderSettings(settingsRepository, now)
  const {
    annotations,
    status: annotationStatus,
    error: annotationError,
    failure,
    canTransfer,
    transferResult,
    addBookmark,
    addHighlight,
    setHighlightColor,
    removeAnnotation,
    exportAnnotations,
    importAnnotations
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

        const spineCount = spineLength(book)
        const locator = locatorFromRelocation(toRelocationInput(location, spineCount), now())
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
                percent: locator.percent,
                chapterIndex: locator.chapterIndex,
                spineCount,
                page: location.start?.displayed?.page ?? null,
                totalPages: location.start?.displayed?.total ?? null
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
  //
  // 判据是「当前这一页上有没有书签」，不是「当前这个字符上有没有书签」：
  // 改字号 / 行高 / 页边距之后同一个字符的 cfi 会变，按 cfi 精确相等去找
  // 必然落空，按钮变回「加书签」，用户再点一下就在旧书签旁边加出第二条。
  // 页号是 epub.js 亲自报的，不依赖任何 CFI 字符串解析。
  const bookmarkAt =
    position === null
      ? undefined
      : annotations.find(
          (item) => item.kind === 'bookmark' && isOnCurrentPage(item, position)
        )

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

  // 加书签只在这里有意义：TXT 后端不开放注解，也就没有「当前落点」这个概念
  const bookmarkAction = (
    <button type="button" disabled={!canAnnotate || position === null} onClick={toggleBookmark}>
      {bookmarkAt ? '移除书签' : '加书签'}
    </button>
  )

  return (
    <ReaderChrome
      title={title}
      theme={theme}
      status={status}
      percent={percent}
      loadError={error}
      annotationError={failure}
      panel={panel}
      onPanelChange={setPanel}
      onClose={onClose}
      extraActions={bookmarkAction}
      bodyRef={bodyRef}
      onMove={move}
    >
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
          canTransfer={canTransfer}
          transferResult={transferResult}
          onExport={() => void exportAnnotations()}
          onImport={() => void importAnnotations()}
          onSelect={goToAnnotation}
          onRemove={removeAnnotation}
          onClose={() => setPanel('none')}
        />
      ) : null}
      {panel === 'settings' && settings ? (
        <SettingsPanel settings={settings} onChange={update} onClose={() => setPanel('none')} />
      ) : null}
    </ReaderChrome>
  )
}
