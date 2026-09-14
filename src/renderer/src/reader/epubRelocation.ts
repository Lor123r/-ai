import type { RelocationInput } from '@core/domain/progress'
import type { EpubRelocation } from './createEpubBook'

/**
 * 把 epub.js 的 relocated 载荷翻译成领域层的定位输入。
 * epub.js 的事件字段全是可选的，这里统一收敛成明确的 null，
 * 让 percentFromRelocation 只需处理一种形状。
 */
export function toRelocationInput(location: EpubRelocation, spineCount: number): RelocationInput {
  const start = location.start

  return {
    cfi: start?.cfi ?? null,
    chapterIndex: start?.index ?? null,
    page: start?.displayed?.page ?? null,
    totalPages: start?.displayed?.total ?? null,
    spineCount,
    atEnd: location.atEnd === true
  }
}
