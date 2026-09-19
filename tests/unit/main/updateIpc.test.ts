import { describe, expect, it, vi } from 'vitest'
import type { IpcMain } from 'electron'
import type { UpdateCheckResult } from '@core/domain/update'
import { registerUpdateIpc } from '../../../src/main/ipc/updateIpc'
import { UPDATE_CHANNELS } from '@shared/ipc'

/** 只实现 handle 的最小 IpcMain 替身，够断言「注册了哪个频道、返回什么」。 */
function makeIpcMain(): { ipcMain: IpcMain; handlers: Map<string, () => unknown> } {
  const handlers = new Map<string, () => unknown>()

  const ipcMain = {
    handle: (channel: string, listener: () => unknown) => {
      handlers.set(channel, listener)
    }
  } as unknown as IpcMain

  return { ipcMain, handlers }
}

const AVAILABLE: UpdateCheckResult = {
  status: 'available',
  latestVersion: '0.2.0',
  currentVersion: '0.1.0'
}

describe('registerUpdateIpc', () => {
  it('注册 update:check 频道', () => {
    const { ipcMain, handlers } = makeIpcMain()

    registerUpdateIpc(ipcMain, async () => AVAILABLE)

    expect(handlers.has(UPDATE_CHANNELS.check)).toBe(true)
  })

  it('原样返回检查结果', async () => {
    const { ipcMain, handlers } = makeIpcMain()

    registerUpdateIpc(ipcMain, async () => AVAILABLE)

    await expect(handlers.get(UPDATE_CHANNELS.check)?.()).resolves.toEqual(AVAILABLE)
  })

  it('⭐ 只检查一次：结果缓存在闭包里', async () => {
    // 渲染层每次挂载书架都会问一次，而启动路径上的网络请求不该被重复触发
    const check = vi.fn(async () => AVAILABLE)
    const { ipcMain, handlers } = makeIpcMain()

    registerUpdateIpc(ipcMain, check)
    const handler = handlers.get(UPDATE_CHANNELS.check)

    await handler?.()
    await handler?.()
    await handler?.()

    expect(check).toHaveBeenCalledTimes(1)
  })

  it('⭐ 并发调用共用同一次请求', async () => {
    // 缓存的是 Promise 而不是结果：并发的两次调用必须共用同一次请求，
    // 而不是各发一次（缓存结果的话，第二次调用会看到 null 又去发一次）
    let resolve: (value: UpdateCheckResult) => void = () => undefined
    const check = vi.fn(
      () =>
        new Promise<UpdateCheckResult>((r) => {
          resolve = r
        })
    )
    const { ipcMain, handlers } = makeIpcMain()

    registerUpdateIpc(ipcMain, check)
    const handler = handlers.get(UPDATE_CHANNELS.check)

    const first = handler?.()
    const second = handler?.()
    resolve(AVAILABLE)

    await expect(first).resolves.toEqual(AVAILABLE)
    await expect(second).resolves.toEqual(AVAILABLE)
    expect(check).toHaveBeenCalledTimes(1)
  })
})
