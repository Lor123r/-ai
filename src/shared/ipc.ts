import type { BookRepository } from '../core/ports/bookRepository'
import type { BookImporter } from '../core/ports/bookImporter'
import type { CoverReader } from '../core/ports/bookCover'
import type { BookContentReader } from '../core/ports/bookContent'
import type { SettingsRepository } from '../core/ports/settingsRepository'

/** IPC 频道名集中定义，避免主进程与 preload 各写一份字符串而写错。 */
export const BOOK_CHANNELS = {
  list: 'books:list',
  get: 'books:get',
  save: 'books:save',
  remove: 'books:remove',
  getLocator: 'books:get-locator',
  saveLocator: 'books:save-locator',
  markOpened: 'books:mark-opened'
} as const

export const LIBRARY_CHANNELS = {
  import: 'library:import',
  readCover: 'library:read-cover',
  readContent: 'library:read-content'
} as const

export const SETTINGS_CHANNELS = {
  load: 'settings:load',
  save: 'settings:save'
} as const

export interface RuntimeVersions {
  node: string
  chrome: string
  electron: string
}

/** preload 通过 contextBridge 暴露给渲染进程的完整接口。 */
export interface AppBridge {
  versions: RuntimeVersions
  books: BookRepository
  library: BookImporter
  cover: CoverReader
  content: BookContentReader
  settings: SettingsRepository
}
