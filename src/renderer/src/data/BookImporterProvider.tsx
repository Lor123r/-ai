import { createContext, useContext, useState, type ReactNode } from 'react'
import type { BookImporter } from '@core/ports/bookImporter'
import { createBookImporter } from './createBookImporter'

const BookImporterContext = createContext<BookImporter | null>(null)

export interface BookImporterProviderProps {
  /** 测试可注入假导入器；不传时用默认实现（浏览器里为 null）。 */
  importer?: BookImporter | null
  children: ReactNode
}

export function BookImporterProvider({
  importer,
  children
}: BookImporterProviderProps): React.JSX.Element {
  const [fallback] = useState(createBookImporter)

  return (
    <BookImporterContext.Provider value={importer === undefined ? fallback : importer}>
      {children}
    </BookImporterContext.Provider>
  )
}

export function useBookImporter(): BookImporter | null {
  return useContext(BookImporterContext)
}
