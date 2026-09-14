import type { BookContentReader } from '@core/ports/bookContent'

export function createBookContentReader(): BookContentReader | null {
  const bridge = typeof window === 'undefined' ? undefined : window.api
  return bridge?.content ?? null
}
