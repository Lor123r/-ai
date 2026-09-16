import { useState } from 'react'
import { AnnotationRepositoryProvider } from '@renderer/data/AnnotationRepositoryProvider'
import { BookContentReaderProvider } from '@renderer/data/BookContentReaderProvider'
import { BookImporterProvider } from '@renderer/data/BookImporterProvider'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import { CoverReaderProvider } from '@renderer/data/CoverReaderProvider'
import { SettingsRepositoryProvider } from '@renderer/data/SettingsRepositoryProvider'
import Bookshelf from '@renderer/shelf/Bookshelf'
import ReaderView from '@renderer/reader/ReaderView'
import type { ShelfEntry } from '@renderer/hooks/useBooks'

export default function App(): React.JSX.Element {
  const [activeEntry, setActiveEntry] = useState<ShelfEntry | null>(null)

  return (
    <BookRepositoryProvider>
      <BookImporterProvider>
        <CoverReaderProvider>
          <BookContentReaderProvider>
            <SettingsRepositoryProvider>
              <AnnotationRepositoryProvider>
                {activeEntry ? (
                  <ReaderView
                    bookId={activeEntry.book.id}
                    title={activeEntry.book.title}
                    onClose={() => setActiveEntry(null)}
                  />
                ) : (
                  <Bookshelf onOpen={setActiveEntry} />
                )}
              </AnnotationRepositoryProvider>
            </SettingsRepositoryProvider>
          </BookContentReaderProvider>
        </CoverReaderProvider>
      </BookImporterProvider>
    </BookRepositoryProvider>
  )
}
