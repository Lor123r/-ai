import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import type { BookRepository } from '@core/ports/bookRepository'

/**
 * 选择书籍仓库实现。
 * 在 Electron 里用 preload 暴露的 IPC 桥（数据落在主进程的 library.json）；
 * 纯浏览器预览与单元测试环境下 window.api 不存在，回落到内存实现，
 * 保证 UI 层无论在哪种宿主里都能完整跑通。
 */
export function createBookRepository(): BookRepository {
  const bridge = typeof window === 'undefined' ? undefined : window.api
  return bridge?.books ?? new InMemoryBookRepository()
}
