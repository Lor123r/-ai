import { createContext, useContext, useState, type ReactNode } from 'react'
import type { CoverReader } from '@core/ports/bookCover'
import { createCoverReader } from './createCoverReader'

const CoverReaderContext = createContext<CoverReader | null>(null)

export interface CoverReaderProviderProps {
  /** 测试可注入假读取器；不传时用默认实现（浏览器里为 null）。 */
  reader?: CoverReader | null
  children: ReactNode
}

export function CoverReaderProvider({
  reader,
  children
}: CoverReaderProviderProps): React.JSX.Element {
  const [fallback] = useState(createCoverReader)

  return (
    <CoverReaderContext.Provider value={reader === undefined ? fallback : reader}>
      {children}
    </CoverReaderContext.Provider>
  )
}

export function useCoverReader(): CoverReader | null {
  return useContext(CoverReaderContext)
}
