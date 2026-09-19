import type { UpdateCheckResult } from '@core/domain/update'

export type { UpdateCheckResult }

/**
 * 读取 preload 注入的更新接口。
 * 在纯浏览器环境（单元测试、Web 预览）下 window.api 不存在，返回 undefined。
 */
export function getUpdateBridge(): { check: () => Promise<UpdateCheckResult> } | undefined {
  const api = typeof window === 'undefined' ? undefined : window.api
  return api?.update
}
