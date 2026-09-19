import { describe, expect, it } from 'vitest'
import type { IpcMain } from 'electron'
import { registerRuntimeIpc } from '../../../src/main/ipc/runtimeIpc'
import { RUNTIME_CHANNELS } from '@shared/ipc'

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

const VERSIONS = {
  app: '0.1.0',
  node: '24.21.0',
  chrome: '140.0.0',
  electron: '38.2.0'
}

describe('registerRuntimeIpc', () => {
  it('注册 runtime:versions 频道', () => {
    const { ipcMain, handlers } = makeIpcMain()

    registerRuntimeIpc(ipcMain, VERSIONS)

    expect(handlers.has(RUNTIME_CHANNELS.versions)).toBe(true)
  })

  it('原样返回传入的版本信息', () => {
    const { ipcMain, handlers } = makeIpcMain()

    registerRuntimeIpc(ipcMain, VERSIONS)

    expect(handlers.get(RUNTIME_CHANNELS.versions)?.()).toEqual(VERSIONS)
  })

  it('版本信息由调用方传入，模块自己不读 app', () => {
    // 这条钉的是「preload 里读 app.getVersion() 会炸」那个坑的镜像面：
    // 应用版本必须由主进程侧读好再传进来，模块本身不 import electron 的 app，
    // 否则这个文件就没法在单测里跑。
    const { ipcMain, handlers } = makeIpcMain()

    registerRuntimeIpc(ipcMain, { ...VERSIONS, app: '9.9.9' })

    expect(handlers.get(RUNTIME_CHANNELS.versions)?.()).toMatchObject({ app: '9.9.9' })
  })
})
