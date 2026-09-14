import type { ReaderSettings } from '../domain/settings'

/** 阅读设置的持久化端口。load() 必须返回已归一化的配置。 */
export interface SettingsRepository {
  load(): Promise<ReaderSettings>
  save(settings: ReaderSettings): Promise<void>
}
