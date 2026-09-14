import { describe, expect, it } from 'vitest'
import {
  JsonSettingsRepository,
  SETTINGS_SNAPSHOT_VERSION,
  parseSettingsSnapshot,
  serializeSettingsSnapshot
} from '@core/adapters/jsonSettingsRepository'
import { InMemoryTextStore } from '@core/adapters/inMemoryTextStore'
import { DEFAULT_READER_SETTINGS } from '@core/domain/settings'

const NOW = 1_700_000_000_000

describe('parseSettingsSnapshot', () => {
  it('空存档回落到默认配置', () => {
    expect(parseSettingsSnapshot(null)).toEqual(DEFAULT_READER_SETTINGS)
    expect(parseSettingsSnapshot('')).toEqual(DEFAULT_READER_SETTINGS)
    expect(parseSettingsSnapshot('   \n ')).toEqual(DEFAULT_READER_SETTINGS)
  })

  it('读得出一份完整配置', () => {
    const raw = serializeSettingsSnapshot({ ...DEFAULT_READER_SETTINGS, fontSize: 26, theme: 'night' }, NOW)

    expect(parseSettingsSnapshot(raw)).toEqual({ ...DEFAULT_READER_SETTINGS, fontSize: 26, theme: 'night' })
  })

  it('不是 JSON 时回落默认，不抛错', () => {
    expect(parseSettingsSnapshot('{ 这不是 JSON')).toEqual(DEFAULT_READER_SETTINGS)
  })

  it('JSON 合法但不是对象时回落默认', () => {
    expect(parseSettingsSnapshot('42')).toEqual(DEFAULT_READER_SETTINGS)
    expect(parseSettingsSnapshot('null')).toEqual(DEFAULT_READER_SETTINGS)
    expect(parseSettingsSnapshot('"day"')).toEqual(DEFAULT_READER_SETTINGS)
  })

  it('缺少 settings 字段时回落默认', () => {
    expect(parseSettingsSnapshot(JSON.stringify({ version: 1, updatedAt: NOW }))).toEqual(
      DEFAULT_READER_SETTINGS
    )
  })

  it('settings 残缺时逐字段收敛，能救的字段仍然保留', () => {
    const raw = JSON.stringify({ version: 1, settings: { fontSize: 22, theme: '不存在' } })

    expect(parseSettingsSnapshot(raw)).toEqual({ ...DEFAULT_READER_SETTINGS, fontSize: 22 })
  })

  it('越界值被夹到边界而不是直接丢弃', () => {
    const raw = JSON.stringify({ version: 1, settings: { fontSize: 999, pageMargin: -50 } })

    expect(parseSettingsSnapshot(raw)).toMatchObject({ fontSize: 36, pageMargin: 0 })
  })

  it('不认识的版本号仍然按同一套规则解析，避免升级后设置丢失', () => {
    const raw = JSON.stringify({ version: 99, settings: { fontSize: 20 } })

    expect(parseSettingsSnapshot(raw)).toMatchObject({ fontSize: 20 })
  })
})

describe('serializeSettingsSnapshot', () => {
  it('写入版本号、时间戳与设置本体', () => {
    const raw = serializeSettingsSnapshot(DEFAULT_READER_SETTINGS, NOW)
    const parsed = JSON.parse(raw) as { version: number; updatedAt: number; settings: unknown }

    expect(parsed.version).toBe(SETTINGS_SNAPSHOT_VERSION)
    expect(parsed.updatedAt).toBe(NOW)
    expect(parsed.settings).toEqual(DEFAULT_READER_SETTINGS)
  })

  it('序列化再解析能原样还原', () => {
    const settings = { ...DEFAULT_READER_SETTINGS, fontSize: 30, lineHeight: 2.1, fontFamily: 'sans' as const }

    expect(parseSettingsSnapshot(serializeSettingsSnapshot(settings, NOW))).toEqual(settings)
  })
})

describe('JsonSettingsRepository', () => {
  it('没有存档时读到默认配置', async () => {
    const repo = new JsonSettingsRepository(new InMemoryTextStore())

    await expect(repo.load()).resolves.toEqual(DEFAULT_READER_SETTINGS)
  })

  it('保存后新建实例能从同一份文本读回', async () => {
    const store = new InMemoryTextStore()
    await new JsonSettingsRepository(store, () => NOW).save({ ...DEFAULT_READER_SETTINGS, fontSize: 24 })

    const reopened = new JsonSettingsRepository(store)
    await expect(reopened.load()).resolves.toMatchObject({ fontSize: 24 })
  })

  it('落盘用的是注入的时间', async () => {
    const store = new InMemoryTextStore()
    await new JsonSettingsRepository(store, () => NOW).save(DEFAULT_READER_SETTINGS)

    expect(JSON.parse(store.current ?? '')).toMatchObject({ updatedAt: NOW })
  })

  it('保存时归一化输入，越界值不会写进存档', async () => {
    const store = new InMemoryTextStore()
    await new JsonSettingsRepository(store).save({ ...DEFAULT_READER_SETTINGS, fontSize: 999, theme: 'nope' as never })

    await expect(new JsonSettingsRepository(store).load()).resolves.toMatchObject({ fontSize: 36, theme: 'day' })
  })

  it('存档损坏时读回默认配置，而不是把错误抛给用户', async () => {
    const repo = new JsonSettingsRepository(new InMemoryTextStore('{ 半截 JSON'))

    await expect(repo.load()).resolves.toEqual(DEFAULT_READER_SETTINGS)
  })

  it('写盘失败时错误向上抛出，调用方可以决定怎么处理', async () => {
    const store = new InMemoryTextStore()
    store.failWith(new Error('磁盘已满'))

    await expect(new JsonSettingsRepository(store).save(DEFAULT_READER_SETTINGS)).rejects.toThrow('磁盘已满')
  })
})
