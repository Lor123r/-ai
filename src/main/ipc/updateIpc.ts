import type { IpcMain } from 'electron'
import type { UpdateCheckResult } from '@core/domain/update'
import { UPDATE_CHANNELS } from '@shared/ipc'

/**
 * 注册检查更新的 IPC。
 *
 * 检查函数由调用方传入而不是在这里 import：这个模块刻意不碰 electron 与网络，
 * 好让它在单测里能直接跑（和 runtimeIpc 同一个理由）。
 *
 * 结果**缓存**在闭包里：渲染层每次挂载书架都会问一次，而启动路径上的网络请求
 * 不该被重复触发。缓存的是 Promise 而不是结果，这样并发的两次调用会共用同一次
 * 请求，而不是各发一次。
 */
export function registerUpdateIpc(
  ipcMain: IpcMain,
  check: () => Promise<UpdateCheckResult>
): void {
  let pending: Promise<UpdateCheckResult> | null = null

  ipcMain.handle(UPDATE_CHANNELS.check, () => {
    pending ??= check()
    return pending
  })
}
