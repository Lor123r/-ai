export const READER_THEMES = ['day', 'night', 'sepia'] as const
export type ReaderTheme = (typeof READER_THEMES)[number]

export const READER_FONT_FAMILIES = ['serif', 'sans'] as const
export type ReaderFontFamily = (typeof READER_FONT_FAMILIES)[number]

export interface ReaderSettings {
  /** 正文字号，单位 px。 */
  fontSize: number
  /** 行高倍数。 */
  lineHeight: number
  /** 页边距，单位 px。 */
  pageMargin: number
  theme: ReaderTheme
  fontFamily: ReaderFontFamily
}

export const READER_LIMITS = {
  fontSize: { min: 12, max: 36 },
  lineHeight: { min: 1.2, max: 2.4 },
  pageMargin: { min: 0, max: 96 }
} as const

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 18,
  lineHeight: 1.7,
  pageMargin: 32,
  theme: 'day',
  fontFamily: 'serif'
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < min) return min
  if (value > max) return max
  return value
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function pickOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * 把任意来源（旧版本配置、用户输入、损坏的存档）的设置收敛为一份合法配置。
 * 越界值被夹到边界，非法值回落到默认值。
 */
export function normalizeReaderSettings(patch?: Partial<ReaderSettings> | null): ReaderSettings {
  if (!patch) return { ...DEFAULT_READER_SETTINGS }

  return {
    fontSize: Math.round(
      clampNumber(patch.fontSize, READER_LIMITS.fontSize.min, READER_LIMITS.fontSize.max, DEFAULT_READER_SETTINGS.fontSize)
    ),
    lineHeight: roundTo(
      clampNumber(
        patch.lineHeight,
        READER_LIMITS.lineHeight.min,
        READER_LIMITS.lineHeight.max,
        DEFAULT_READER_SETTINGS.lineHeight
      ),
      2
    ),
    pageMargin: Math.round(
      clampNumber(
        patch.pageMargin,
        READER_LIMITS.pageMargin.min,
        READER_LIMITS.pageMargin.max,
        DEFAULT_READER_SETTINGS.pageMargin
      )
    ),
    theme: pickOption(patch.theme, READER_THEMES, DEFAULT_READER_SETTINGS.theme),
    fontFamily: pickOption(patch.fontFamily, READER_FONT_FAMILIES, DEFAULT_READER_SETTINGS.fontFamily)
  }
}

export function readerSettingsEqual(a: ReaderSettings, b: ReaderSettings): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.lineHeight === b.lineHeight &&
    a.pageMargin === b.pageMargin &&
    a.theme === b.theme &&
    a.fontFamily === b.fontFamily
  )
}
