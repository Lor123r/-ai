import { createContext, useContext, useState, type ReactNode } from 'react'
import type { AnnotationTransfer } from '@core/ports/annotationTransfer'
import { createAnnotationTransfer } from './createAnnotationTransfer'

const AnnotationTransferContext = createContext<AnnotationTransfer | null | undefined>(undefined)

export interface AnnotationTransferProviderProps {
  /**
   * 显式注入：`null` 表示这次运行确实没有交换能力（浏览器预览、或测试里只关心别的
   * 行为），不传才走默认探测。
   *
   * 这两者必须分得开。若用同一个默认值，测试里想表达「没有桥」就得真的去改 window.api，
   * 而一旦有人忘了清理，后面的用例会跟着一起变。
   */
  transfer?: AnnotationTransfer | null
  children: ReactNode
}

export function AnnotationTransferProvider({
  transfer,
  children
}: AnnotationTransferProviderProps): React.JSX.Element {
  const [fallback] = useState(createAnnotationTransfer)

  return (
    <AnnotationTransferContext.Provider value={transfer === undefined ? fallback : transfer}>
      {children}
    </AnnotationTransferContext.Provider>
  )
}

/**
 * 允许为 null：调用方要的正是「这次运行有没有交换能力」，能不能导出得由它自己决定。
 * 这里不抛错，是因为「没有桥」是一个正常状态（浏览器预览），不是接线漏了。
 */
export function useAnnotationTransfer(): AnnotationTransfer | null {
  const transfer = useContext(AnnotationTransferContext)
  if (transfer === undefined) throw new Error('缺少 AnnotationTransferProvider，请在上层包裹它')
  return transfer
}
