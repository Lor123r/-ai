import { useState } from 'react'
import { formatPercentLabel, isBookFinished } from '@core/domain/progress'
import { useBookImporter } from '@renderer/data/BookImporterProvider'
import { useBooks, type ShelfEntry } from '@renderer/hooks/useBooks'
import { formatRuntimeLabel, getRuntimeVersions } from '@renderer/platform/runtime'
import BookCover from './BookCover'
import { describeImportFailures, describeImportResult } from './importNotice'

function progressText(locator: ShelfEntry['locator']): string {
  if (!locator) return '尚未开始'
  if (isBookFinished(locator.percent)) return '已读完'
  return `已读 ${formatPercentLabel(locator.percent)}`
}

interface BookCardProps {
  entry: ShelfEntry
  onRemove: (id: string) => void
}

function BookCard({ entry, onRemove }: BookCardProps): React.JSX.Element {
  const { book, locator } = entry
  const percent = Math.round((locator?.percent ?? 0) * 100)

  return (
    <li className="book-card">
      <BookCover bookId={book.id} title={book.title} />
      <h3 className="book-card__title" title={book.title}>
        {book.title}
      </h3>
      <p className="book-card__author">{book.author ?? '未知作者'}</p>
      <div
        className="book-card__progress"
        role="progressbar"
        aria-label={`${book.title} 阅读进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="book-card__progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="book-card__footer">
        <span className="book-card__meta">{progressText(locator)}</span>
        <button
          type="button"
          className="book-card__remove"
          aria-label={`删除《${book.title}》`}
          onClick={() => onRemove(book.id)}
        >
          删除
        </button>
      </div>
    </li>
  )
}

export default function Bookshelf(): React.JSX.Element {
  const { entries, status, error, reload, removeBook } = useBooks()
  const importer = useBookImporter()
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const runtimeLabel = formatRuntimeLabel(getRuntimeVersions())

  async function handleRemove(id: string): Promise<void> {
    try {
      await removeBook(id)
      setActionError(null)
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function handleImport(): Promise<void> {
    if (!importer) return

    setImporting(true)
    try {
      const summary = await importer.pickAndImport()
      // 用户点了取消什么也没发生，保持原有提示不变
      if (summary) {
        await reload()
        setNotice(describeImportResult(summary))
        setActionError(describeImportFailures(summary.failed))
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-header__title">书架</h1>
        <span className="app-header__meta">
          {status === 'ready' && entries.length > 0 ? <span className="app-header__count">{entries.length} 本</span> : null}
          {importer ? (
            <button
              type="button"
              className="app-header__action"
              onClick={() => void handleImport()}
              disabled={importing}
            >
              {importing ? '正在导入…' : '导入书籍'}
            </button>
          ) : null}
          <span className="app-header__runtime">{runtimeLabel}</span>
        </span>
      </header>
      <main className="app-body" data-status={status}>
        {status === 'loading' ? <p className="empty-hint">正在读取书架…</p> : null}
        {status === 'error' ? <p className="error-hint">读取书架失败：{error}</p> : null}
        {status === 'ready' && notice ? (
          <p className="status-banner" role="status">
            {notice}
          </p>
        ) : null}
        {status === 'ready' && entries.length === 0 ? (
          <p className="empty-hint">书架还是空的，导入 EPUB 后就会出现在这里。</p>
        ) : null}
        {status === 'ready' && entries.length > 0 ? (
          <ul className="shelf">
            {entries.map((entry) => (
              <BookCard key={entry.book.id} entry={entry} onRemove={(id) => void handleRemove(id)} />
            ))}
          </ul>
        ) : null}
      </main>
      {actionError ? <p className="error-banner">操作失败：{actionError}</p> : null}
    </div>
  )
}
