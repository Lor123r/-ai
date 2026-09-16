import type { BookRepository } from '../core/ports/bookRepository'
import type { BookImporter } from '../core/ports/bookImporter'
import type { CoverReader } from '../core/ports/bookCover'
import type { BookContentReader } from '../core/ports/bookContent'
import type { SettingsRepository } from '../core/ports/settingsRepository'
import type { AnnotationRepository } from '../core/ports/annotationRepository'

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

export const ANNOTATION_CHANNELS = {
  list: 'annotations:list',
  save: 'annotations:save',
  remove: 'annotations:remove'
} as const

/**
 * 渲染层能看到的注解接口，刻意比 AnnotationRepository 窄：
 * 少了 load()（启动期由主进程预读，渲染进程没有理由再触发一次读盘）
 * 和 removeByBook()（只给主进程的删书流程用 —— 删书必须先删书、后删注解，
 * 反序时删书失败就会造出「书还在、划线没了」的真数据丢失）。
 * 用 Pick 而不是另写一份声明：端口改了这里会跟着编译报错，不会有第二份定义走样。
 */
export type AnnotationBridge = Pick<AnnotationRepository, 'listByBook' | 'save' | 'remove'>

export interface RuntimeVersions {
  node: string
  chrome: string
  electron: string
}

/** preload 通过 contextBridge 暴露给渲染进程的完整接口。 */
export interface AppBridge {
  versions: RuntimeVersions
  books: BookRepository
  annotations: AnnotationBridge
  library: BookImporter
  cover: CoverReader
  content: BookContentReader
  settings: SettingsRepository
}
