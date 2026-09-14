import type { RuntimeVersions } from '@shared/ipc'

export type { RuntimeVersions }

/**
 * 读取 preload 注入的运行时版本信息。
 * 在纯浏览器环境（单元测试、Web 预览）下 window.api 不存在，返回 undefined。
 */
export function getRuntimeVersions(): RuntimeVersions | undefined {
  const api = typeof window === 'undefined' ? undefined : window.api
  return api?.versions
}

export function formatRuntimeLabel(versions: RuntimeVersions | undefined): string {
  if (!versions) return '浏览器预览模式'
  return `Electron ${versions.electron} · Chromium ${versions.chrome}`
}
