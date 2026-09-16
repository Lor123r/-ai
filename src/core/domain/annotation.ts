import { isFiniteNumber, isNonEmptyString, isRecord } from './guards'
import { clampPercent, normalizeCfi } from './progress'

export type AnnotationKind = 'bookmark' | 'highlight'

/** 划线配色。取值刻意做成英文枚举，渲染层再映射成实际色值。 */
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink'

interface AnnotationBase {
  /** 调用方注入，core 不生成随机 id（确定性与可注入性）。 */
  id: string
  bookId: string
  /** epub.js 的 CFI 字符串，跳转一律优先用它。 */
  cfi: string
  /** 章节 href，仅用于列表展示；非法时为 ''。 */
  chapterHref: string
  /** 全书进度，0 ~ 1。 */
  percent: number
  note: string
  createdAt: number
  updatedAt: number
}

export interface BookmarkAnnotation extends AnnotationBase {
  kind: 'bookmark'
}

export interface HighlightAnnotation extends AnnotationBase {
  kind: 'highlight'
  excerpt: string
  color: HighlightColor
}

export type Annotation = BookmarkAnnotation | HighlightAnnotation

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink']
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'yellow'

export const MAX_NOTE_LENGTH = 2000
export const MAX_EXCERPT_LENGTH = 2000
/**
 * CFI 上限。超长一律整条拒绝而不能截断：截断出来的 CFI 语法无效，
 * 会造出一个永远定位不到的注解，比直接丢弃更糟。
 */
export const MAX_CFI_LENGTH = 512
export const MAX_HREF_LENGTH = 512

export interface BookmarkInput {
  id: string
  bookId: string
  cfi: string
  chapterHref?: string
  percent?: number
  note?: string
}

export interface HighlightInput {
  id: string
  bookId: string
  cfi: string
  chapterHref?: string
  percent?: number
  note?: string
  excerpt?: string
  color?: HighlightColor
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

/** 带 scheme 的绝对 URL，例如 javascript: / data: / http: / mailto:。 */
const ABSOLUTE_URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** 清理文本：控制字符与换行压成单空格，trim，超长则截断（截断后仍是合法文本）。 */
function normalizeText(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return ''

  const cleaned = raw.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) return ''

  return cleaned.slice(0, maxLength)
}

/** 笔记文本：非字符串回落空串，其余按 normalizeText 清理。 */
export function normalizeNote(raw: unknown): string {
  return normalizeText(raw, MAX_NOTE_LENGTH)
}

/** 划线摘录：与笔记同样的清理方式，只是上限独立。 */
export function normalizeExcerpt(raw: unknown): string {
  return normalizeText(raw, MAX_EXCERPT_LENGTH)
}

/** 非法配色一律回落默认色，绝不把未知字符串透传给渲染层。 */
export function normalizeHighlightColor(raw: unknown): HighlightColor {
  return HIGHLIGHT_COLORS.includes(raw as HighlightColor) ? (raw as HighlightColor) : DEFAULT_HIGHLIGHT_COLOR
}

export function isAnnotationKind(raw: unknown): raw is AnnotationKind {
  return raw === 'bookmark' || raw === 'highlight'
}

/** 复用 progress 的 CFI 清理（trim + 空串转 null），再套上注解自己的长度上限。 */
export function normalizeAnnotationCfi(raw: unknown): string | null {
  const cfi = normalizeCfi(raw)
  if (cfi === null) return null

  return cfi.length > MAX_CFI_LENGTH ? null : cfi
}

/**
 * 章节 href 只用于「列表展示 + 跳转兜底」，跳转优先用 cfi，所以这里比 toc.ts 的
 * cleanHref 更严：带 scheme 的绝对 URL（javascript: / data: / http: / mailto:）
 * 一律丢弃，避免把外部可执行地址存下来下次直接回显。
 * 合法的 EPUB 相对 href（ch1.xhtml、text/ch1.xhtml#sec1、../img/a.png）原样保留。
 */
export function normalizeChapterHref(raw: unknown): string {
  if (typeof raw !== 'string') return ''

  // 先去控制字符再判 scheme，否则 'java\u0000script:' 这类写法能绕过拦截
  const cleaned = raw.replace(CONTROL_CHARACTERS, '').trim()
  if (cleaned.length === 0) return ''
  if (ABSOLUTE_URL_SCHEME.test(cleaned)) return ''

  return cleaned.length > MAX_HREF_LENGTH ? '' : cleaned
}

/**
 * 注解列表排序：新建的排在前面，时间相同用 id 兜底，
 * 保证任何实现（内存、SQLite）都返回完全一致的顺序。
 */
export function compareAnnotationsForList(a: Annotation, b: Annotation): number {
  const createdDiff = b.createdAt - a.createdAt
  if (createdDiff !== 0) return createdDiff

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function requireAnnotationId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : ''
  if (id.length === 0) throw new Error('注解 id 不能为空')
  return id
}

function requireAnnotationBookId(raw: unknown): string {
  const bookId = typeof raw === 'string' ? raw.trim() : ''
  if (bookId.length === 0) throw new Error('注解所属书籍 id 不能为空')
  return bookId
}

/** CFI 是注解的唯一落点，缺失就直接抛错，不用空串兜底造出定位不到的注解。 */
function requireAnnotationCfi(raw: unknown): string {
  const cfi = typeof raw === 'string' ? raw.trim() : ''
  if (cfi.length === 0) throw new Error('注解定位不能为空')
  if (cfi.length > MAX_CFI_LENGTH) throw new Error('注解定位过长')
  return cfi
}

export function createBookmark(input: BookmarkInput, now: number = Date.now()): BookmarkAnnotation {
  return {
    id: requireAnnotationId(input.id),
    bookId: requireAnnotationBookId(input.bookId),
    kind: 'bookmark',
    cfi: requireAnnotationCfi(input.cfi),
    chapterHref: normalizeChapterHref(input.chapterHref),
    percent: clampPercent(input.percent),
    note: normalizeNote(input.note),
    createdAt: now,
    updatedAt: now
  }
}

export function createHighlight(input: HighlightInput, now: number = Date.now()): HighlightAnnotation {
  return {
    id: requireAnnotationId(input.id),
    bookId: requireAnnotationBookId(input.bookId),
    kind: 'highlight',
    cfi: requireAnnotationCfi(input.cfi),
    chapterHref: normalizeChapterHref(input.chapterHref),
    percent: clampPercent(input.percent),
    note: normalizeNote(input.note),
    excerpt: normalizeExcerpt(input.excerpt),
    color: normalizeHighlightColor(input.color),
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 把未知来源的数据（磁盘存档、IPC 参数）还原为 Annotation。
 * id / bookId / kind / cfi 任一非法就返回 null 让调用方丢弃该条，
 * 其余字段逐项收敛，避免一条脏数据让整本书的注解都读不出来。
 */
export function reviveAnnotation(raw: unknown, now: number = Date.now()): Annotation | null {
  if (!isRecord(raw)) return null

  const id = isNonEmptyString(raw.id) ? raw.id.trim() : null
  const bookId = isNonEmptyString(raw.bookId) ? raw.bookId.trim() : null
  if (id === null || bookId === null) return null

  const kind = raw.kind
  if (!isAnnotationKind(kind)) return null

  const cfi = normalizeAnnotationCfi(raw.cfi)
  if (cfi === null) return null

  const createdAt = isFiniteNumber(raw.createdAt) && raw.createdAt >= 0 ? Math.round(raw.createdAt) : now
  // updatedAt 缺失时回落到 createdAt，而不是 now，否则每次读盘都会「刷新」修改时间
  const updatedAt =
    isFiniteNumber(raw.updatedAt) && raw.updatedAt >= 0 ? Math.round(raw.updatedAt) : createdAt

  const base = {
    id,
    bookId,
    cfi,
    chapterHref: normalizeChapterHref(raw.chapterHref),
    percent: clampPercent(raw.percent),
    note: normalizeNote(raw.note),
    createdAt,
    updatedAt
  }

  // 判别联合要分开构造，不能把 kind 塞进 base 再 spread，那样 TS 收窄不了
  if (kind === 'highlight') {
    return {
      ...base,
      kind: 'highlight',
      excerpt: normalizeExcerpt(raw.excerpt),
      color: normalizeHighlightColor(raw.color)
    }
  }

  return { ...base, kind: 'bookmark' }
}
