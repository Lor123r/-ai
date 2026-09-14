import { describe, expect, it } from 'vitest'
import {
  DEFAULT_READER_SETTINGS,
  normalizeReaderSettings,
  readerSettingsEqual,
  READER_LIMITS
} from '@core/domain/settings'

describe('normalizeReaderSettings', () => {
  it('空输入返回默认配置的副本', () => {
    const settings = normalizeReaderSettings()
    expect(settings).toEqual(DEFAULT_READER_SETTINGS)
    expect(settings).not.toBe(DEFAULT_READER_SETTINGS)
  })

  it('越界数值被夹到边界而不是被丢弃', () => {
    expect(normalizeReaderSettings({ fontSize: 999 }).fontSize).toBe(READER_LIMITS.fontSize.max)
    expect(normalizeReaderSettings({ fontSize: 1 }).fontSize).toBe(READER_LIMITS.fontSize.min)
    expect(normalizeReaderSettings({ pageMargin: -20 }).pageMargin).toBe(READER_LIMITS.pageMargin.min)
    expect(normalizeReaderSettings({ lineHeight: 10 }).lineHeight).toBe(READER_LIMITS.lineHeight.max)
  })

  it('非法数值回落到默认值', () => {
    expect(normalizeReaderSettings({ fontSize: Number.NaN }).fontSize).toBe(DEFAULT_READER_SETTINGS.fontSize)
    expect(normalizeReaderSettings({ lineHeight: 'big' as unknown as number }).lineHeight).toBe(
      DEFAULT_READER_SETTINGS.lineHeight
    )
  })

  it('字号取整、行高保留两位小数，避免出现 18.33333px', () => {
    const settings = normalizeReaderSettings({ fontSize: 18.6, lineHeight: 1.7666666 })
    expect(settings.fontSize).toBe(19)
    expect(settings.lineHeight).toBe(1.77)
  })

  it('非法枚举值回落到默认主题与字体', () => {
    const settings = normalizeReaderSettings({
      theme: 'neon' as never,
      fontFamily: '' as never
    })
    expect(settings.theme).toBe(DEFAULT_READER_SETTINGS.theme)
    expect(settings.fontFamily).toBe(DEFAULT_READER_SETTINGS.fontFamily)
  })

  it('合法枚举值被保留', () => {
    const settings = normalizeReaderSettings({ theme: 'night', fontFamily: 'sans' })
    expect(settings.theme).toBe('night')
    expect(settings.fontFamily).toBe('sans')
  })

  it('返回值是纯数据，修改它不会污染默认配置', () => {
    const settings = normalizeReaderSettings()
    settings.fontSize = 30
    expect(DEFAULT_READER_SETTINGS.fontSize).toBe(18)
  })
})

describe('readerSettingsEqual', () => {
  it('字段完全一致时相等', () => {
    expect(readerSettingsEqual(normalizeReaderSettings(), { ...DEFAULT_READER_SETTINGS })).toBe(true)
  })

  it('任一字段不同即不相等', () => {
    expect(readerSettingsEqual(normalizeReaderSettings(), normalizeReaderSettings({ theme: 'night' }))).toBe(false)
    expect(readerSettingsEqual(normalizeReaderSettings(), normalizeReaderSettings({ fontSize: 19 }))).toBe(false)
  })
})
