import { describe, expect, it } from 'vitest'
import { InMemorySettingsRepository } from '@core/adapters/inMemorySettingsRepository'
import { DEFAULT_READER_SETTINGS } from '@core/domain/settings'

describe('InMemorySettingsRepository', () => {
  it('未提供初始值时返回默认设置', async () => {
    await expect(new InMemorySettingsRepository().load()).resolves.toEqual(DEFAULT_READER_SETTINGS)
  })

  it('构造时提供的设置会被归一化', async () => {
    const repo = new InMemorySettingsRepository({ fontSize: 999, theme: 'night' })
    await expect(repo.load()).resolves.toMatchObject({ fontSize: 36, theme: 'night' })
  })

  it('保存后可以读回，且返回值与内部状态解耦', async () => {
    const repo = new InMemorySettingsRepository()
    await repo.save({ ...DEFAULT_READER_SETTINGS, fontSize: 24 })

    const loaded = await repo.load()
    expect(loaded.fontSize).toBe(24)

    loaded.fontSize = 12
    await expect(repo.load()).resolves.toMatchObject({ fontSize: 24 })
  })

  it('保存越界值也会被夹回合法范围', async () => {
    const repo = new InMemorySettingsRepository()
    await repo.save({ ...DEFAULT_READER_SETTINGS, lineHeight: 99 })
    await expect(repo.load()).resolves.toMatchObject({ lineHeight: 2.4 })
  })
})
