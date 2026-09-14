import type { BookImporter } from '@core/ports/bookImporter'

/**
 * 选择导入器实现。
 * 只有 Electron 里存在 preload 桥（主进程才会弹文件选择框），
 * 纯浏览器预览时返回 null，由 UI 决定隐藏入口而不是给出一个点了没反应的按钮。
 */
export function createBookImporter(): BookImporter | null {
  const bridge = typeof window === 'undefined' ? undefined : window.api
  return bridge?.library ?? null
}
