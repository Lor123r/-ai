import { join } from 'node:path'
import { JsonSettingsRepository } from '@core/adapters/jsonSettingsRepository'
import type { SettingsRepository } from '@core/ports/settingsRepository'
import { FileTextStore } from './fileTextStore'

export const SETTINGS_FILE_NAME = 'settings.json'

export function resolveSettingsFilePath(userDataDir: string): string {
  return join(userDataDir, SETTINGS_FILE_NAME)
}

/** 阅读设置损坏不影响启动，所以这里不需要书库那样的备份与恢复流程。 */
export function openSettings(filePath: string, now: () => number = Date.now): SettingsRepository {
  return new JsonSettingsRepository(new FileTextStore(filePath), now)
}
