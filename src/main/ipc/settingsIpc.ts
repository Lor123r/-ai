import type { IpcMain } from 'electron'
import { reviveReaderSettings } from '@core/domain/settings'
import type { SettingsRepository } from '@core/ports/settingsRepository'
import { SETTINGS_CHANNELS } from '@shared/ipc'

/**
 * 注册阅读设置 IPC。
 * 这里不做「不合法就报错」的严格校验：设置面板的每个字段都有明确取值范围，
 * 归一化就是最自然的校验，越界值被夹紧远比整次保存失败更符合用户预期。
 */
export function registerSettingsIpc(ipcMain: IpcMain, repository: SettingsRepository): void {
  ipcMain.handle(SETTINGS_CHANNELS.load, () => repository.load())

  ipcMain.handle(SETTINGS_CHANNELS.save, (_event, raw: unknown) =>
    repository.save(reviveReaderSettings(raw))
  )
}
