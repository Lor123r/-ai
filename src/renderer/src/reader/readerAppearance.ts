import type { CSSProperties } from 'react'
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

/** 内联 style 里的自定义属性。React 的 CSSProperties 不认 -- 开头的键，得自己开个口子。 */
export type ReaderAppearanceStyle = CSSProperties & { [key: `--${string}`]: string }

/**
 * 把阅读设置变成一串 CSS 变量，写给宿主文档里的正文用（applyReaderSettings 那套是写给
 * epub.js 的 iframe 的，override 只在那个文档里生效）。
 *
 * 只给字号、行高、字体、页边距：颜色刻意不进变量 —— 外壳上的 .reader[data-theme] 已经
 * 定义了 --paper / --ink，正文作为后代直接继承，同一组配色就不会在 TS 和 CSS 里各存一份。
 */
export function readerAppearanceStyle(settings: ReaderSettings): ReaderAppearanceStyle {
  return {
    '--reader-font-size': `${settings.fontSize}px`,
    '--reader-line-height': String(settings.lineHeight),
    '--reader-page-margin': `${settings.pageMargin}px`,
    '--reader-font-family': FONT_STACKS[settings.fontFamily]
  }
}
