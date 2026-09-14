import { createContext, useContext, useState, type ReactNode } from 'react'
import type { BookRepository } from '@core/ports/bookRepository'
import { createBookRepository } from './createBookRepository'

const BookRepositoryContext = createContext<BookRepository | null>(null)

export interface BookRepositoryProviderProps {
  /** 测试与未来的持久化实现可注入；不传时使用默认实现。 */
  repository?: BookRepository
  children: ReactNode
}

export function BookRepositoryProvider({
  repository,
  children
}: BookRepositoryProviderProps): React.JSX.Element {
  const [fallback] = useState(createBookRepository)

  return (
    <BookRepositoryContext.Provider value={repository ?? fallback}>{children}</BookRepositoryContext.Provider>
  )
}

export function useBookRepository(): BookRepository {
  const repository = useContext(BookRepositoryContext)
  if (!repository) throw new Error('缺少 BookRepositoryProvider，请在上层包裹它')
  return repository
}
