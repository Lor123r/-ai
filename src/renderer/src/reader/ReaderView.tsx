import { useEffect, useRef, useState } from 'react'
import { formatPercentLabel, locatorFromRelocation } from '@core/domain/progress'
import { useBookContentReader } from '@renderer/data/BookContentReaderProvider'
import { useBookRepository } from '@renderer/data/BookRepositoryProvider'
import { createEpubBook, spineLength, type EpubBook, type EpubRendition } from './createEpubBook'
import { toRelocationInput } from './epubRelocation'
import { createLocatorWriter, type LocatorWriter } from './locatorWriter'

interface ReaderViewProps {
  bookId: string
  title: string
  onClose: () => void
  createBook?: (bytes: Uint8Array) => EpubBook
  now?: () => number
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
  const viewportRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<EpubRendition | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [percent, setPercent] = useState<number | null>(null)

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
  }, [bookId, contentReader, repository, createBook, now])

  function move(direction: 'next' | 'prev'): void {
    const rendition = renditionRef.current
    if (!rendition || status !== 'ready') return
    void rendition[direction]().then(
      () => setError(null),
      (caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    )
  }

  return (
    <section className="reader" aria-label={`正在阅读《${title}》`}>
      <header className="reader__header">
        <button type="button" onClick={onClose}>返回书架</button>
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
      <div ref={viewportRef} className="reader__viewport" data-status={status} />
      <footer className="reader__controls">
        <button type="button" onClick={() => move('prev')} disabled={status !== 'ready'}>上一页</button>
        <button type="button" onClick={() => move('next')} disabled={status !== 'ready'}>下一页</button>
      </footer>
    </section>
  )
}
