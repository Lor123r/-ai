import { reviveReaderSettings, type ReaderSettings } from '../domain/settings'
import type { SettingsRepository } from '../ports/settingsRepository'
import type { TextStore } from '../ports/textStore'

export const SETTINGS_SNAPSHOT_VERSION = 1

interface SettingsSnapshot {
  version: number
  updatedAt: number
  settings: ReaderSettings
}

/**
 * 从存档文本里读出阅读设置。
 * 与书库不同，配置读不出来不值得中断启动，也不值得留下一份损坏备份，
 * 所以任何解析问题都直接回落到默认值。
 */
export function parseSettingsSnapshot(raw: string | null): ReaderSettings {
  if (raw === null || raw.trim() === '') return reviveReaderSettings(null)

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return reviveReaderSettings(null)
    return reviveReaderSettings((parsed as { settings?: unknown }).settings)
  } catch {
    return reviveReaderSettings(null)
  }
}

export function serializeSettingsSnapshot(settings: ReaderSettings, now: number): string {
  const snapshot: SettingsSnapshot = { version: SETTINGS_SNAPSHOT_VERSION, updatedAt: now, settings }
  return JSON.stringify(snapshot, null, 2)
}

/** 阅读设置的落盘实现。save() 写入的是归一化之后的配置，读回来的必然也是合法的。 */
export class JsonSettingsRepository implements SettingsRepository {
  constructor(
    private readonly store: TextStore,
    private readonly now: () => number = Date.now
  ) {}

  async load(): Promise<ReaderSettings> {
    return parseSettingsSnapshot(await this.store.read())
  }

  async save(settings: ReaderSettings): Promise<void> {
    const normalized = reviveReaderSettings(settings)
    await this.store.write(serializeSettingsSnapshot(normalized, this.now()))
  }
}
