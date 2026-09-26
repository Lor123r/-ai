/**
 * 宿主契约（AppBridge 等）定义在 `bridge.ts`，这里只做转出。
 *
 * 拆开的理由：契约是「渲染进程需要什么」，与「Electron 怎么跨进程传」是两件事。
 * 安卓宿主不需要任何 IPC 频道，但需要同一份契约。混在一个文件里会让契约被
 * 频道常量拖住，换宿主时无法复用。
 */
export type {
  AnnotationBridge,
  AppBridge,
  RuntimeVersions,
  UpdateBridge
} from './bridge'

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
 * 运行时版本信息的频道。
 *
 * 单独走 IPC 而不是在 preload 里直接读：`app` 是**主进程专属**模块，preload 跑在渲染
 * 进程里，`electron.app` 是 undefined，`app.getVersion()` 会在 preload 加载时直接抛错，
 * 把整个 `contextBridge.exposeInMainWorld` 一起带走 —— 表现是 `window.api` 变成
 * undefined，界面上所有功能静默失效。`process.versions.*` 在 preload 里可用，但应用
 * 自身版本只有主进程知道。
 */
export const RUNTIME_CHANNELS = {
  versions: 'runtime:versions'
} as const

/**
 * 检查更新的频道。
 *
 * 只有「查」没有「装」：未签名的更新包在 Windows 上会被 electron-updater 拒绝，
 * 所以这一轮只做到「告诉用户有新版本」，下载与安装仍由用户手动完成。
 */
export const UPDATE_CHANNELS = {
  check: 'update:check'
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
 *
 * 定义在 `bridge.ts`，这里转出以保持既有 import 路径可用。
 */
