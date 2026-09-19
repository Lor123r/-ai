import type { IpcMain } from 'electron'
import type { RuntimeVersions } from '@shared/ipc'
import { RUNTIME_CHANNELS } from '@shared/ipc'

/**
 * 注册运行时版本信息 IPC。
 *
 * 为什么不让 preload 自己读：`app` 是**主进程专属**模块，preload 跑在渲染进程里，
 * `electron.app` 是 undefined。`app.getVersion()` 会在 preload 加载时直接抛错，把
 * 整个 `contextBridge.exposeInMainWorld` 一起带走 —— 表现是 `window.api` 变成
 * undefined，界面上所有功能静默失效，而且主进程侧看不到任何报错。
 *
 * 版本信息由调用方传入而不是在这里读 `app`：这个模块刻意不 import electron 的 app，
 * 好让它在单测里能直接跑。
 */
export function registerRuntimeIpc(ipcMain: IpcMain, versions: RuntimeVersions): void {
  ipcMain.handle(RUNTIME_CHANNELS.versions, () => versions)
}
