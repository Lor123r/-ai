import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { InMemorySettingsRepository } from '@core/adapters/inMemorySettingsRepository'
import { DEFAULT_READER_SETTINGS } from '@core/domain/settings'
import { SETTINGS_CHANNELS } from '@shared/ipc'
import { registerSettingsIpc } from '../../../src/main/ipc/settingsIpc'

type Handler = (event: unknown, ...args: unknown[]) => unknown

/** 用假 ipcMain 抓住注册的 handler，无需启动 Electron 就能测协议层。 */
function setup(): { handlers: Map<string, Handler>; repository: InMemorySettingsRepository } {
  const repository = new InMemorySettingsRepository()
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, listener: Handler) => {
      handlers.set(channel, listener)
    }
  } as unknown as IpcMain

  registerSettingsIpc(ipcMain, repository)
  return { handlers, repository }
}

async function call(handlers: Map<string, Handler>, channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`频道未注册：${channel}`)
  return await handler({}, ...args)
}

describe('registerSettingsIpc', () => {
  it('注册了全部设置频道', () => {
    const { handlers } = setup()

    expect([...handlers.keys()].sort()).toEqual(Object.values(SETTINGS_CHANNELS).sort())
  })

  it('没保存过时 load 返回默认配置', async () => {
    const { handlers } = setup()

    await expect(call(handlers, SETTINGS_CHANNELS.load)).resolves.toEqual(DEFAULT_READER_SETTINGS)
  })

  it('save 之后 load 能读回同一份配置', async () => {
    const { handlers } = setup()
    const settings = { ...DEFAULT_READER_SETTINGS, fontSize: 26, theme: 'night' as const }

    await call(handlers, SETTINGS_CHANNELS.save, settings)

    await expect(call(handlers, SETTINGS_CHANNELS.load)).resolves.toEqual(settings)
  })

  it('save 收到越界值时夹到边界，而不是让整次保存失败', async () => {
    const { handlers } = setup()

    await call(handlers, SETTINGS_CHANNELS.save, { ...DEFAULT_READER_SETTINGS, fontSize: 400 })

    await expect(call(handlers, SETTINGS_CHANNELS.load)).resolves.toMatchObject({ fontSize: 36 })
  })

  it('save 收到非对象时写回默认配置，不会抛错', async () => {
    const { handlers } = setup()

    await expect(call(handlers, SETTINGS_CHANNELS.save, null)).resolves.toBeUndefined()
    await expect(call(handlers, SETTINGS_CHANNELS.load)).resolves.toEqual(DEFAULT_READER_SETTINGS)
  })

  it('save 收到非法主题时回落到默认主题', async () => {
    const { handlers } = setup()

    await call(handlers, SETTINGS_CHANNELS.save, { ...DEFAULT_READER_SETTINGS, theme: 'neon', fontFamily: 7 })

    await expect(call(handlers, SETTINGS_CHANNELS.load)).resolves.toMatchObject({
      theme: DEFAULT_READER_SETTINGS.theme,
      fontFamily: DEFAULT_READER_SETTINGS.fontFamily
    })
  })

  it('仓库抛错时调用以 reject 结束', async () => {
    const { handlers, repository } = setup()
    vi.spyOn(repository, 'load').mockRejectedValueOnce(new Error('磁盘炸了'))

    await expect(call(handlers, SETTINGS_CHANNELS.load)).rejects.toThrow('磁盘炸了')
  })

  it('保存失败时错误向上抛出，渲染进程可以决定是否提示', async () => {
    const { handlers, repository } = setup()
    vi.spyOn(repository, 'save').mockRejectedValueOnce(new Error('磁盘已满'))

    await expect(call(handlers, SETTINGS_CHANNELS.save, DEFAULT_READER_SETTINGS)).rejects.toThrow('磁盘已满')
  })
})
