import type { AppBridge } from '@shared/bridge'

declare global {
  interface Window {
    /** 由 preload 通过 contextBridge 注入；在纯浏览器环境（如单元测试）中不存在。 */
    api?: AppBridge
  }
}

export {}
