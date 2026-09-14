import { useEffect, useRef, useState } from 'react'
import { formatPercentLabel, locatorFromRelocation } from '@core/domain/progress'
import type { TocEntry } from '@core/domain/toc'
import { useBookContentReader } from '@renderer/data/BookContentReaderProvider'
import { useBookRepository } from '@renderer/data/BookRepositoryProvider'
import { useSettingsRepository } from '@renderer/data/SettingsRepositoryProvider'
import SettingsPanel from './SettingsPanel'
import TocDrawer from './TocDrawer'
import { createEpubBook, spineLength, type EpubBook, type EpubRendition } from './createEpubBook'
import { readToc } from './epubToc'
import { toRelocationInput } from './epubRelocation'
import { createLocatorWriter, type LocatorWriter } from './locatorWriter'
import { applyReaderSettings } from './readerAppearance'
import { useReaderSettings } from './useReaderSettings'

interface ReaderViewProps {
  bookId: string
  title: string
  onClose: () => void
  createBook?: (bytes: Uint8Array) => EpubBook
  now?: () => number
}

type Panel = 'none' | 'toc' | 'settings'

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
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<EpubRendition | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  const [toc, setToc] = useState<TocEntry[]>([])
  const [panel, setPanel] = useState<Panel>('none')
  const { settings, update } = useReaderSettings(settingsRepository, now)
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

      rendition.on('relocated', (location) => {
        if (!active) return

        const locator = locatorFromRelocation(toRelocationInput(location, spineLength(book)), now())
        setPercent(locator.percent)
        writer?.push(locator)
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
      renditionRef.current?.destroy()
      bookRef.current?.destroy()
      renditionRef.current = null
      bookRef.current = null
    }
  }, [bookId, contentReader, repository, createBook, now, settingsReady])

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
      <div className="reader__body">
        <div ref={viewportRef} className="reader__viewport" data-status={status} />
        {panel === 'toc' ? (
          <TocDrawer entries={toc} onSelect={goTo} onClose={() => setPanel('none')} />
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
