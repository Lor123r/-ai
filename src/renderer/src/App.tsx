import { BookImporterProvider } from '@renderer/data/BookImporterProvider'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import { CoverReaderProvider } from '@renderer/data/CoverReaderProvider'
import Bookshelf from '@renderer/shelf/Bookshelf'

export default function App(): React.JSX.Element {
  return (
    <BookRepositoryProvider>
      <BookImporterProvider>
        <CoverReaderProvider>
          <Bookshelf />
        </CoverReaderProvider>
      </BookImporterProvider>
    </BookRepositoryProvider>
  )
}
