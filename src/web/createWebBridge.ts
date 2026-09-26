import { normalizeAnnotationBookId, reviveAnnotation } from '@core/domain/annotation'
import type { AppBridge } from '@shared/bridge'
import { IdbAnnotationRepository } from './idbAnnotationRepository'
import { IdbBookRepository } from './idbBookRepository'
import { IdbBookContentReader, IdbCoverReader } from './idbBlobStore'
import { IdbSettingsRepository } from './idbSettingsRepository'
import { WebAnnotationTransfer } from './webAnnotationTransfer'
import { WebBookImporter } from './webBookImporter'

/**
 * 浏览器 / 安卓 WebView 宿主的 AppBridge 实现。
 *
 * 这是「换宿主」这件事的全部代价：Electron 用 preload + ipcRenderer 实现 AppBridge，
 * 这里用 IndexedDB + WebCrypto + input[type=file] 实现同一个接口。渲染层一行都不用改 ——
 * 它本来就只认 window.api 这个形状，不认背后是谁。
 *
 * 版本信息：浏览器里没有 Electron / Node，如实报 navigator.userAgent 里的 Chromium 版本，
 * 并把 electron 字段留成空串。渲染层的 formatRuntimeLabel 会因此显示成
 * 「v0.1.0 · Electron 」—— 这是已知的显示瑕疵，等安卓端真正落地时再按宿主分支处理，
 * 现在先不为了好看而编造一个不存在的 Electron 版本号。
 */
export function createWebBridge(appVersion: string): AppBridge {
  const books = new IdbBookRepository()
  const annotations = new IdbAnnotationRepository()

  return {
    versions: Promise.resolve({
      app: appVersion,
      node: '',
      chrome: chromiumVersion(),
      electron: ''
    }),
    update: {
      // 浏览器 / 安卓走应用商店或手动安装更新，没有自更新通道。
      // 用 not-packaged 而不是 network：前者是「这个构建本来就不该检查更新」，
      // 界面一个字都不显示；后者会被当成「检查失败了」，让用户以为网络有问题。
      check: async () => ({ status: 'unavailable' as const, reason: 'not-packaged' as const })
    },
    books,
    annotations: {
      listByBook: (bookId) => annotations.listByBook(requireBookId(bookId)),
      // 与主进程 annotationsIpc 同款的信任边界：渲染层递来的对象一律先过 reviveAnnotation
      // （逐字段收敛 + 非法整条拒绝），而不是直接落盘。浏览器宿主里没有 IPC 边界，
      // 但「渲染层的数据不可信」这条不因为换了宿主就消失 —— 页面里任何脚本都能调 window.api。
      save: (raw) => {
        const annotation = reviveAnnotation(raw)
        if (!annotation) throw new Error('注解数据不合法')
        return annotations.save(annotation)
      },
      remove: (bookId, annotationId) => annotations.remove(requireBookId(bookId), annotationId)
    },
    annotationTransfer: new WebAnnotationTransfer({ books, annotations }),
    library: new WebBookImporter({ books }),
    cover: new IdbCoverReader(),
    content: new IdbBookContentReader(),
    settings: new IdbSettingsRepository()
  }
}

/** 从 UA 里抠出 Chromium 主版本号；抠不到就返回空串，不编造。 */
function chromiumVersion(): string {
  const match = /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent)
  return match?.[1] ?? ''
}

/** 与主进程 requireBookId 同款：bookId 到这一层已经在信任边界之外。 */
function requireBookId(value: unknown): string {
  const bookId = normalizeAnnotationBookId(value)
  if (bookId === null) throw new Error('注解所属书籍 id 不合法')
  return bookId
}
