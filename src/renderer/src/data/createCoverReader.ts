import type { CoverReader } from '@core/ports/bookCover'

/**
 * 选择封面读取器实现。
 * 纯浏览器预览时没有 preload 桥，返回 null，书架上退化为文字占位块。
 */
export function createCoverReader(): CoverReader | null {
  const bridge = typeof window === 'undefined' ? undefined : window.api
  return bridge?.cover ?? null
}
