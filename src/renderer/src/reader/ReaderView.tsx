import { useEffect, useRef, useState } from 'react'
import { useBookContentReader } from '@renderer/data/BookContentReaderProvider'
import { createEpubBook, type EpubBook, type EpubRendition } from './createEpubBook'

interface ReaderViewProps {
  bookId: string
  title: string
  onClose: () => void
  createBook?: (bytes: Uint8Array) => EpubBook
}

export default function ReaderView({
  bookId,
  title,
  onClose,
  createBook = createEpubBook
}: ReaderViewProps): React.JSX.Element {
  const contentReader = useBookContentReader()
  const viewportRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<EpubRendition | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const viewport = viewportRef.current
    if (!contentReader || !viewport) {
      setStatus('error')
      setError('当前环境无法读取书籍正文')
      return () => {
        active = false
      }
    }

    void contentReader
      .read(bookId)
      .then((bytes) => {
        if (!active) return
        if (!bytes) throw new Error('书籍文件不存在')

        const book = createBook(bytes)
        const rendition = book.renderTo(viewport, { width: '100%', height: '100%', flow: 'paginated' })
        bookRef.current = book
        renditionRef.current = rendition
        return book.ready.then(() => rendition.display())
      })
      .then(() => {
        if (active) setStatus('ready')
      })
      .catch((caught: unknown) => {
        if (active) {
          setStatus('error')
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      })

    return () => {
      active = false
      renditionRef.current?.destroy()
      bookRef.current?.destroy()
      renditionRef.current = null
      bookRef.current = null
    }
  }, [bookId, contentReader, createBook])

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
        <span>{status === 'loading' ? '正在打开…' : status === 'ready' ? '阅读中' : '打开失败'}</span>
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
