import type { BookRepository } from '../core/ports/bookRepository'
import type { BookImporter } from '../core/ports/bookImporter'
import type { CoverReader } from '../core/ports/bookCover'
import type { BookContentReader } from '../core/ports/bookContent'
import type { SettingsRepository } from '../core/ports/settingsRepository'
import type { AnnotationRepository } from '../core/ports/annotationRepository'
import type { AnnotationTransfer } from '../core/ports/annotationTransfer'
import type { UpdateCheckResult } from '../core/domain/update'

/**
 * 宿主契约：渲染进程能看到的全部能力。
 *
 * **这个文件刻意不 import electron，也不 import 任何 IPC 频道常量。**
 * 它描述的是「渲染进程需要宿主提供什么」，而不是「这些能力怎么跨进程传」。
 * Electron 用 preload + ipcRenderer 实现它，安卓用 Capacitor 插件实现它，
 * 单元测试用内存实现它 —— 三者共用同一份类型，端口改了这里会跟着编译报错。
 *
 * 频道常量留在 `ipc.ts`：那是 Electron 这一种实现的内部细节，
 * 换宿主时整份作废，不该被契约文件拖住。
 */

/**
 * 渲染层能看到的注解接口，刻意比 AnnotationRepository 窄：
 * 少了 load()（启动期由主进程预读，渲染进程没有理由再触发一次读盘）
 * 和 removeByBook()（只给主进程的删书流程用 —— 删书必须先删书、后删注解，
 * 反序时删书失败就会造出「书还在、划线没了」的真数据丢失）。
 * 用 Pick 而不是另写一份声明：端口改了这里会跟着编译报错，不会有第二份定义走样。
 */
export type AnnotationBridge = Pick<AnnotationRepository, 'listByBook' | 'save' | 'remove'>

export interface RuntimeVersions {
  /** 应用自身版本，来自 package.json 的 version（打包后由 electron-builder 写进产物）。 */
  app: string
  node: string
  chrome: string
  electron: string
}

/**
 * 渲染层能看到的更新接口。
 *
 * 刻意只有一个 `check()`：这一轮不做下载与安装（未签名的更新包会被 Windows 拒绝），
 * 所以没有 `download()` / `install()` 可暴露。等签名到位再加，那时这里会多两个方法，
 * 而不是现在先摆两个空壳。
 */
export interface UpdateBridge {
  check: () => Promise<UpdateCheckResult>
}

/** 宿主通过 contextBridge（或等价机制）暴露给渲染进程的完整接口。 */
export interface AppBridge {
  /** 版本信息是异步的：应用版本只有主进程知道，见 RUNTIME_CHANNELS 的注释。 */
  versions: Promise<RuntimeVersions>
  update: UpdateBridge
  books: BookRepository
  annotations: AnnotationBridge
  annotationTransfer: AnnotationTransfer
  library: BookImporter
  cover: CoverReader
  content: BookContentReader
  settings: SettingsRepository
}
