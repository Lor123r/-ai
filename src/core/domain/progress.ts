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

/** 渲染器报告的一次位置变化。字段都可能缺失，由下面的纯函数补齐默认值。 */
export interface RelocationInput {
  cfi?: string | null
  /** 章节序号，从 0 开始；未知时传 null。 */
  chapterIndex?: number | null
  /** 章节内的第几页，从 1 开始。 */
  page?: number | null
  /** 当前章节的总页数。 */
  totalPages?: number | null
  /** 全书章节数。 */
  spineCount: number
  /** 已经翻到全书最后一页。 */
  atEnd?: boolean
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function pageFraction(page: unknown, totalPages: unknown): number {
  const total = toPositiveInteger(totalPages)
  // 章节只有一页时无从区分首尾，算作章节开头
  if (total === null || total <= 1) return 0

  const current = toPositiveInteger(page)
  if (current === null) return 0

  // 首尾页要刚好落在章节的两端，否则最后一页永远凑不满 100%
  return clampPercent((Math.min(current, total) - 1) / (total - 1))
}

/**
 * 按「章节位置 + 章节内页码」估算全书进度。
 * 刻意不用 epub.js 的 locations.generate()：那一步要预先扫过整本书，
 * 对 MVP 来说代价太高，而章节加页码已经足够让进度条动起来。
 */
export function percentFromRelocation(input: RelocationInput): number {
  if (input.atEnd === true) return 1

  const spineCount = toPositiveInteger(input.spineCount)
  const chapterIndex = normalizeChapterIndex(input.chapterIndex)
  if (spineCount === null || chapterIndex === null) return 0

  const index = Math.min(chapterIndex, spineCount - 1)
  return clampPercent((index + pageFraction(input.page, input.totalPages)) / spineCount)
}

export function locatorFromRelocation(input: RelocationInput, now: number = Date.now()): ReadingLocator {
  return createLocator(
    {
      cfi: input.cfi,
      percent: percentFromRelocation(input),
      chapterIndex: input.chapterIndex
    },
    now
  )
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
