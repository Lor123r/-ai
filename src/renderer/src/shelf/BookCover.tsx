import { useCoverReader } from '@renderer/data/CoverReaderProvider'
import { useCoverDataUrl } from './useCoverDataUrl'

interface BookCoverProps {
  bookId: string
  title: string
}

/** 封面图；没有封面时显示书名首字，避免书架出现一排空洞。 */
export default function BookCover({ bookId, title }: BookCoverProps): React.JSX.Element {
  const reader = useCoverReader()
  const dataUrl = useCoverDataUrl(reader, bookId)

  if (dataUrl) {
    return (
      <div className="book-card__cover">
        <img className="book-card__cover-image" src={dataUrl} alt={`《${title}》封面`} />
      </div>
    )
  }

  return (
    <div className="book-card__cover" data-placeholder="true">
      <span className="book-card__cover-letter" aria-hidden="true">
        {Array.from(title)[0] ?? '书'}
      </span>
    </div>
  )
}
