import { createContext, useContext, useState, type ReactNode } from 'react'
import type { BookContentReader } from '@core/ports/bookContent'
import { createBookContentReader } from './createBookContentReader'

const BookContentReaderContext = createContext<BookContentReader | null>(null)

export interface BookContentReaderProviderProps {
  reader?: BookContentReader | null
  children: ReactNode
}

export function BookContentReaderProvider({
  reader,
  children
}: BookContentReaderProviderProps): React.JSX.Element {
  const [fallback] = useState(createBookContentReader)
  return (
    <BookContentReaderContext.Provider value={reader === undefined ? fallback : reader}>
      {children}
    </BookContentReaderContext.Provider>
  )
}

export function useBookContentReader(): BookContentReader | null {
  return useContext(BookContentReaderContext)
}
