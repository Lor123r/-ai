import { normalizeReaderSettings, type ReaderSettings } from '../domain/settings'
import type { SettingsRepository } from '../ports/settingsRepository'

/** 内存实现：测试用；也是浏览器预览模式下的默认值来源。 */
export class InMemorySettingsRepository implements SettingsRepository {
  private settings: ReaderSettings

  constructor(initial?: Partial<ReaderSettings> | null) {
    this.settings = normalizeReaderSettings(initial)
  }

  async load(): Promise<ReaderSettings> {
    return { ...this.settings }
  }

  async save(settings: ReaderSettings): Promise<void> {
    this.settings = normalizeReaderSettings(settings)
  }
}
