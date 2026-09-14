import { InMemorySettingsRepository } from '@core/adapters/inMemorySettingsRepository'
import type { SettingsRepository } from '@core/ports/settingsRepository'

/** 与 createBookRepository 同样的取舍：有 IPC 桥就持久化，否则退化成会话内有效。 */
export function createSettingsRepository(): SettingsRepository {
  const bridge = typeof window === 'undefined' ? undefined : window.api
  return bridge?.settings ?? new InMemorySettingsRepository()
}
