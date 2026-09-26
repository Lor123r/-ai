import { normalizeReaderSettings, type ReaderSettings } from '@core/domain/settings'
import type { SettingsRepository } from '@core/ports/settingsRepository'
import { STORE, get, put } from './idb'

/** 设置只有一份，用固定键存。 */
const SETTINGS_KEY = 'reader'

interface SettingsRow {
  key: string
  settings: ReaderSettings
}

/**
 * 浏览器宿主的设置仓库。
 *
 * 读不出来（首次运行、数据被改坏）一律回落默认值而不是抛错：设置读失败不该让应用
 * 起不来，这与主进程「设置损坏直接回落默认值」的约定一致。
 */
export class IdbSettingsRepository implements SettingsRepository {
  async load(): Promise<ReaderSettings> {
    const row = await get<SettingsRow>(STORE.settings, SETTINGS_KEY)
    return normalizeReaderSettings(row?.settings)
  }

  async save(settings: ReaderSettings): Promise<void> {
    await put(STORE.settings, { key: SETTINGS_KEY, settings: normalizeReaderSettings(settings) } satisfies SettingsRow)
  }
}
