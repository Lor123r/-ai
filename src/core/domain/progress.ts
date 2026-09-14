import { isFiniteNumber, isRecord } from './guards'

export interface ReadingLocator {
  /** EPUB 的 CFI 定位串；TXT 或未知位置时为 null。 */
  cfi: string | null
  /** 全书进度，0 ~ 1。 */
  percent: number
  /** 章节序号，从 0 开始；未知时为 null。 */
  chapterIndex: number | null
  updatedAt: number
}

export interface LocatorInput {
  cfi?: string | null
  percent?: number
  chapterIndex?: number | null
}

export const FINISHED_PERCENT_THRESHOLD = 0.995

export function clampPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

export function normalizeCfi(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

export function normalizeChapterIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

export function createLocator(input: LocatorInput = {}, now: number = Date.now()): ReadingLocator {
  return {
    cfi: normalizeCfi(input.cfi),
    percent: clampPercent(input.percent ?? 0),
    chapterIndex: normalizeChapterIndex(input.chapterIndex),
    updatedAt: now
  }
}

/**
 * 判断两个定位是否指向同一处。用于过滤滚动过程中产生的大量重复位置，
 * 避免每次都写库。
 */
export function isSameLocation(a: ReadingLocator | null, b: ReadingLocator | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false

  return a.cfi === b.cfi && a.chapterIndex === b.chapterIndex && clampPercent(a.percent) === clampPercent(b.percent)
}

export function formatPercentLabel(percent: number): string {
  return `${Math.round(clampPercent(percent) * 100)}%`
}

export function isBookFinished(percent: number, threshold: number = FINISHED_PERCENT_THRESHOLD): boolean {
  return clampPercent(percent) >= threshold
}

/** 把未知来源的进度数据还原为 ReadingLocator；非对象一律丢弃。 */
export function reviveLocator(raw: unknown, now: number = Date.now()): ReadingLocator | null {
  if (!isRecord(raw)) return null

  const updatedAt = isFiniteNumber(raw.updatedAt) && raw.updatedAt >= 0 ? Math.round(raw.updatedAt) : now

  return {
    cfi: normalizeCfi(raw.cfi),
    percent: clampPercent(raw.percent),
    chapterIndex: normalizeChapterIndex(raw.chapterIndex),
    updatedAt
  }
}
