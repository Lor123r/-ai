import type { Book } from './book'
import { isBookFinished, type ReadingLocator } from './progress'

/**
 * 书架上的一行：一本书 + 它的阅读进度。
 *
 * 定义在 core 而不是渲染层的 hook 里，是因为排序与筛选是纯函数、属于领域逻辑，
 * 而 core 不能反过来依赖 renderer。`useBooks.ts` 从这里再导出，既有 import 路径不变。
 */
export interface ShelfEntry {
  book: Book
  locator: ReadingLocator | null
}

export const SHELF_SORTS = ['recent', 'added', 'title', 'author', 'progress'] as const
export type ShelfSort = (typeof SHELF_SORTS)[number]

export const SHELF_FILTERS = ['all', 'reading', 'unread', 'finished', 'epub', 'txt'] as const
export type ShelfFilter = (typeof SHELF_FILTERS)[number]

export interface ShelfView {
  sort: ShelfSort
  filter: ShelfFilter
}

export const DEFAULT_SHELF_VIEW: ShelfView = { sort: 'recent', filter: 'all' }

/**
 * 中文书名按 `<` 排是按 UTF-16 码元排（「三体」会排在「活着」前面），
 * 用户期望的是拼音序，所以走 localeCompare。Node 与 Chromium 都带 ICU。
 */
const COLLATOR = new Intl.Collator('zh-Hans-CN')

function pickOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * 把未知来源的视图偏好收敛为合法值。
 * 本轮不落盘，但函数要能扛住存档里的旧字符串，免得将来接上存储时才发现。
 */
export function normalizeShelfView(raw: unknown): ShelfView {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...DEFAULT_SHELF_VIEW }

  const patch = raw as Partial<ShelfView>
  return {
    sort: pickOption(patch.sort, SHELF_SORTS, DEFAULT_SHELF_VIEW.sort),
    filter: pickOption(patch.filter, SHELF_FILTERS, DEFAULT_SHELF_VIEW.filter)
  }
}

/** 所有排序都以 id 兜底，保证任何输入顺序下结果完全一致。 */
function compareById(a: ShelfEntry, b: ShelfEntry): number {
  return a.book.id < b.book.id ? -1 : a.book.id > b.book.id ? 1 : 0
}

/**
 * 按指定键比较两行。
 *
 * `author` 为 null 的一律排最后：`author ?? ''` 会让空串在升序里排最前，
 * 而「未知作者」堆在书架最前面是最没用的排法。
 */
export function compareShelfEntries(a: ShelfEntry, b: ShelfEntry, sort: ShelfSort): number {
  switch (sort) {
    case 'recent': {
      const diff = (b.book.lastOpenedAt ?? 0) - (a.book.lastOpenedAt ?? 0)
      return diff !== 0 ? diff : compareById(a, b)
    }
    case 'added': {
      const diff = b.book.addedAt - a.book.addedAt
      return diff !== 0 ? diff : compareById(a, b)
    }
    case 'title': {
      const diff = COLLATOR.compare(a.book.title, b.book.title)
      return diff !== 0 ? diff : compareById(a, b)
    }
    case 'author': {
      const left = a.book.author
      const right = b.book.author
      if (left === null && right === null) return compareById(a, b)
      if (left === null) return 1
      if (right === null) return -1

      const diff = COLLATOR.compare(left, right)
      return diff !== 0 ? diff : compareById(a, b)
    }
    case 'progress': {
      const diff = (b.locator?.percent ?? 0) - (a.locator?.percent ?? 0)
      return diff !== 0 ? diff : compareById(a, b)
    }
  }
}

/**
 * 筛选判据。
 *
 * `reading` / `unread` / `finished` 三者互斥且穷尽「全部」：
 * reading 是「开了头没读完」，unread 是「一次没开过」，两者加起来就是未读完。
 * 这样用户不会问「我读了一半的书去哪了」。
 */
export function matchesShelfFilter(entry: ShelfEntry, filter: ShelfFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'reading':
      return entry.locator !== null && !isBookFinished(entry.locator.percent)
    case 'unread':
      return entry.locator === null
    case 'finished':
      return entry.locator !== null && isBookFinished(entry.locator.percent)
    case 'epub':
      return entry.book.format === 'epub'
    case 'txt':
      return entry.book.format === 'txt'
  }
}

/** 先筛后排，返回新数组，不改动入参。 */
export function applyShelfView(entries: readonly ShelfEntry[], view: ShelfView): ShelfEntry[] {
  return entries
    .filter((entry) => matchesShelfFilter(entry, view.filter))
    .slice()
    .sort((a, b) => compareShelfEntries(a, b, view.sort))
}
