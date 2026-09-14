import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import type { BookRepository } from '@core/ports/bookRepository'

/**
 * 选择书籍仓库实现。
 * 当前只有内存实现：它同时服务浏览器预览与测试，并保证在尚未接入 SQLite 之前
 * 应用也能完整跑通。后续新增主进程持久化时，只需在这里换成 IPC 适配器，
 * UI 层无需改动。
 */
export function createBookRepository(): BookRepository {
  return new InMemoryBookRepository()
}
