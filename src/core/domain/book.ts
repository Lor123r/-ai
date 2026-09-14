export type BookFormat = 'epub' | 'txt'

export interface Book {
  id: string
  title: string
  author: string | null
  format: BookFormat
  filePath: string
  fileSize: number
  coverPath: string | null
  addedAt: number
  lastOpenedAt: number | null
}

export interface BookInput {
  id: string
  title?: string | null
  author?: string | null
  format: BookFormat
  filePath: string
  fileSize: number
  coverPath?: string | null
}

export const UNTITLED_BOOK_TITLE = '未命名书籍'

const MAX_TITLE_LENGTH = 200
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

/** 从文件扩展名推断书籍格式，无法识别时返回 null。 */
export function detectBookFormat(filePath: string): BookFormat | null {
  const withoutQuery = filePath.split(/[?#]/, 1)[0] ?? ''
  const dotIndex = withoutQuery.lastIndexOf('.')
  if (dotIndex < 0) return null

  const extension = withoutQuery.slice(dotIndex + 1).toLowerCase()
  if (extension === 'epub') return 'epub'
  if (extension === 'txt') return 'txt'
  return null
}

export function normalizeBookTitle(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return UNTITLED_BOOK_TITLE

  const cleaned = raw.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length === 0) return UNTITLED_BOOK_TITLE

  return cleaned.slice(0, MAX_TITLE_LENGTH)
}

export function normalizeBookAuthor(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null

  const cleaned = raw.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length === 0 ? null : cleaned
}

function normalizeFileSize(raw: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0
  return Math.round(raw)
}

export function createBook(input: BookInput, now: number = Date.now()): Book {
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (id.length === 0) throw new Error('书籍 id 不能为空')

  const filePath = typeof input.filePath === 'string' ? input.filePath.trim() : ''
  if (filePath.length === 0) throw new Error('书籍文件路径不能为空')

  return {
    id,
    title: normalizeBookTitle(input.title),
    author: normalizeBookAuthor(input.author),
    format: input.format,
    filePath,
    fileSize: normalizeFileSize(input.fileSize),
    coverPath: typeof input.coverPath === 'string' && input.coverPath.trim() !== '' ? input.coverPath : null,
    addedAt: now,
    lastOpenedAt: null
  }
}

/**
 * 书架排序：最近阅读优先，其次按导入时间倒序，最后用 id 兜底，
 * 保证任何实现（内存、SQLite）都返回完全一致的顺序。
 */
export function compareBooksForShelf(a: Book, b: Book): number {
  const openedDiff = (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)
  if (openedDiff !== 0) return openedDiff

  const addedDiff = b.addedAt - a.addedAt
  if (addedDiff !== 0) return addedDiff

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
