import { createContext, useContext, useState, type ReactNode } from 'react'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import { createAnnotationRepository } from './createAnnotationRepository'

const AnnotationRepositoryContext = createContext<AnnotationRepository | null>(null)

export interface AnnotationRepositoryProviderProps {
  /** 测试可注入；不传时使用默认实现。 */
  repository?: AnnotationRepository
  children: ReactNode
}

export function AnnotationRepositoryProvider({
  repository,
  children
}: AnnotationRepositoryProviderProps): React.JSX.Element {
  const [fallback] = useState(createAnnotationRepository)

  return (
    <AnnotationRepositoryContext.Provider value={repository ?? fallback}>
      {children}
    </AnnotationRepositoryContext.Provider>
  )
}

export function useAnnotationRepository(): AnnotationRepository {
  const repository = useContext(AnnotationRepositoryContext)
  if (!repository) throw new Error('缺少 AnnotationRepositoryProvider，请在上层包裹它')
  return repository
}
