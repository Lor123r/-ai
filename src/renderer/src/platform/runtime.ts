import type { RuntimeVersions } from '@shared/ipc'

export type { RuntimeVersions }

/**
 * 读取 preload 注入的运行时版本信息。
 * 在纯浏览器环境（单元测试、Web 预览）下 window.api 不存在，返回 undefined。
 *
 * 返回的是 Promise：应用版本只有主进程知道，preload 里 `electron.app` 是 undefined
 * （见 RUNTIME_CHANNELS 的注释），所以这里必然是一次异步 IPC。
 */
export function getRuntimeVersions(): Promise<RuntimeVersions> | undefined {
  const api = typeof window === 'undefined' ? undefined : window.api
  return api?.versions
}

/**
 * 书架右上角那行小字。
 *
 * 只报「应用版本 + Electron 版本」：用户报 bug 时关心的是「哪个版本的应用」，Chromium
 * 版本是开发者信息，而且它随 Electron 版本唯一确定，写出来是冗余。Node 版本同理。
 */
export function formatRuntimeLabel(versions: RuntimeVersions | undefined): string {
  if (!versions) return '浏览器预览模式'
  return `v${versions.app} · Electron ${versions.electron}`
}
