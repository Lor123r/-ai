import type { ReaderFontFamily, ReaderSettings, ReaderTheme } from '@core/domain/settings'
import type { EpubThemeStyler } from './createEpubBook'

export interface ThemeColors {
  /** 纸张底色，同时用于阅读器外壳与正文字面。 */
  paper: string
  /** 正文颜色。 */
  ink: string
  /** 次要文字颜色，仅用于阅读器外壳。 */
  inkSoft: string
  /** 分隔线颜色，仅用于阅读器外壳。 */
  line: string
}

export const READER_THEME_COLORS: Record<ReaderTheme, ThemeColors> = {
  day: { paper: '#f6f3ec', ink: '#2f2b26', inkSoft: '#7a736a', line: '#ded7c9' },
  sepia: { paper: '#f4e8d3', ink: '#4a3c28', inkSoft: '#8a7659', line: '#e0d0b2' },
  night: { paper: '#1b1c1e', ink: '#c8c4bc', inkSoft: '#8b8781', line: '#35363a' }
}

export const READER_THEME_LABELS: Record<ReaderTheme, string> = {
  day: '白天',
  night: '夜间',
  sepia: '护眼'
}

export const READER_FONT_LABELS: Record<ReaderFontFamily, string> = {
  serif: '宋体',
  sans: '黑体'
}

const FONT_STACKS: Record<ReaderFontFamily, string> = {
  serif: '"Songti SC", "SimSun", Georgia, serif',
  sans: '"Microsoft YaHei", "PingFang SC", system-ui, sans-serif'
}

/**
 * 把阅读设置写进正文样式。
 * 一律带 !important：书内 CSS 常常自带 font-size 与颜色，不加优先级会盖不住。
 * override 会注册到 content 钩子，新加载的章节会自动重放，所以翻章后设置依然生效。
 */
export function applyReaderSettings(themes: EpubThemeStyler, settings: ReaderSettings): void {
  const colors = READER_THEME_COLORS[settings.theme]

  themes.override('font-size', `${settings.fontSize}px`, true)
  themes.override('line-height', String(settings.lineHeight), true)
  themes.override('font-family', FONT_STACKS[settings.fontFamily], true)
  themes.override('color', colors.ink, true)
  themes.override('background-color', colors.paper, true)
}
