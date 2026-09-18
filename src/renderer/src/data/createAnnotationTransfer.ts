import type { AnnotationTransfer } from '@core/ports/annotationTransfer'

/**
 * 选择注解交换能力。
 *
 * 没有 preload 桥（纯浏览器预览）时返回 null 而不是「支持但每次调用都失败」：
 * 导出导入的每一步都要由主进程弹系统对话框，浏览器里根本无从做起，
 * 给一个点了没反应的按钮比直接不显示还糟。UI 拿到 null 就隐藏这两个入口。
 *
 * 与 createBookImporter 一样直接读 window.api，而不是包一层判断 —— 桥的名字
 * 与形状由 shared/ipc 的 AppBridge 守着，多一层转发只会多一处要同步的地方。
 */
export function createAnnotationTransfer(): AnnotationTransfer | null {
  const bridge = typeof window === 'undefined' ? undefined : window.api
  return bridge?.annotationTransfer ?? null
}
