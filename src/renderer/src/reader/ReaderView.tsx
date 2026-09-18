import type { BookFormat } from '@core/domain/book'
import EpubReaderView from './EpubReaderView'
import TxtReaderView from './TxtReaderView'

interface ReaderViewProps {
  bookId: string
  title: string
  /** 书籍格式。刻意必填：给了默认值就等于把「忘了传」悄悄变成「按 EPUB 打开」。 */
  format: BookFormat
  onClose: () => void
}

/**
 * 阅读器入口，按格式把正文交给对应后端。
 *
 * 两个后端只共用 ReaderChrome 的外壳：TXT 没有 cfi 就回不到原页，EPUB 没有多栏排版、
 * 也不必自己量宽度。把两端强抽成同一个接口只会得到一堆「某一边用不上」的字段。
 * 分派放在这里，两边各自的状态与副作用就都不会跑到对方身上 —— 尤其那条无条件建
 * rendition 的 effect。
 */
export default function ReaderView({ format, ...rest }: ReaderViewProps): React.JSX.Element {
  return format === 'txt' ? <TxtReaderView {...rest} /> : <EpubReaderView {...rest} />
}
