import type { BookRepository } from '../core/ports/bookRepository'
import type { BookImporter } from '../core/ports/bookImporter'
import type { CoverReader } from '../core/ports/bookCover'
import type { BookContentReader } from '../core/ports/bookContent'
import type { SettingsRepository } from '../core/ports/settingsRepository'
import type { AnnotationRepository } from '../core/ports/annotationRepository'
import type { AnnotationTransfer } from '../core/ports/annotationTransfer'

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
 * 注解文件交换的频道。单独成组而不是并进 ANNOTATION_CHANNELS：那三个是「一条一条的
 * 增删查」，这两个是「整本书的一份文件」，实现与信任假设都不一样（要弹系统对话框、
 * 要按用户给的路径读写磁盘）。
 */
export const ANNOTATION_TRANSFER_CHANNELS = {
  exportBook: 'annotations:export',
  importInto: 'annotations:import'
} as const

/**
 * 导入的文件不是可识别的交换格式时，主进程抛出的固定文案。
 *
 * 放在这里而不是两侧各写一份：它必须逐字一致 —— 渲染层靠 includes 认出它，才能把
 * 「文件挑错了，重试也没用」和「导入失败，请重试」分开说。抄错一个字，用户就只会
 * 看到一句「请重试」，而那个重试永远不会成功。
 */
export const ANNOTATION_FILE_INVALID_MESSAGE = '这个文件不是本应用导出的注解文件，或者格式版本不受支持'

/**
 * 导出目标落在应用数据目录里时抛出的固定文案，和上面同理必须逐字一致。
 *
 * 这条尤其要能认出来：用户把另存框的路径改到应用数据目录里是唯一会撞上它的情形，
 * 而那句通用的「导出失败，请重试」会让他一遍遍重试同一个路径，永远失败。
 */
export const ANNOTATION_EXPORT_BOUNDARY_MESSAGE = '不能把注解导出到应用数据目录，请换一个位置'

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
  annotationTransfer: AnnotationTransfer
  library: BookImporter
  cover: CoverReader
  content: BookContentReader
  settings: SettingsRepository
}
