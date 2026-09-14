import ePub from 'epubjs'

export interface EpubDisplayedLocation {
  /** 章节内的第几页，从 1 开始。 */
  page?: number
  /** 当前章节的总页数。 */
  total?: number
}

/** epub.js 的 relocated 事件载荷，只声明我们真正读取的字段。 */
export interface EpubRelocation {
  start?: {
    index?: number
    href?: string
    cfi?: string
    displayed?: EpubDisplayedLocation
  }
  /** 停在全书最后一页时 epub.js 会置上这个标记。 */
  atEnd?: boolean
}

export interface EpubRenderOptions {
  width?: string
  height?: string
  flow?: string
}

export interface EpubNavItem {
  id?: string
  href?: string
  label?: string
  subitems?: EpubNavItem[]
}

export interface EpubNavigation {
  /** epub.js 解析完导航后同步可读，book.ready 之后一定有值；无导航时是空数组。 */
  toc?: EpubNavItem[]
}

export interface EpubThemeStyler {
  override(name: string, value: string, priority?: boolean): void
}

export interface EpubRendition {
  display(target?: string): Promise<unknown>
  next(): Promise<unknown>
  prev(): Promise<unknown>
  on(event: 'relocated', handler: (location: EpubRelocation) => void): void
  /** epub.js 自己监听 window resize，但容器尺寸变化要显式通知，否则排版会停在旧宽度。 */
  resize(width?: number, height?: number): void
  themes?: EpubThemeStyler
  destroy(): void
}

export interface EpubSpineSection {
  href?: string
}

export interface EpubBook {
  ready: Promise<unknown>
  spine?: {
    length?: number
    each?(callback: (section: EpubSpineSection) => void): void
  }
  navigation?: EpubNavigation
  renderTo(element: HTMLElement, options?: EpubRenderOptions): EpubRendition
  destroy(): void
}

/** 全书章节数；拿不到时按 1 章算，进度只会停留在 0 ~ 100% 之间而不会算出 NaN。 */
export function spineLength(book: EpubBook): number {
  const length = book.spine?.length
  return typeof length === 'number' && Number.isInteger(length) && length > 0 ? length : 1
}

/** spine 里各章相对 OPF 的路径，用于把目录里的相对链接对上号。 */
export function spineHrefs(book: EpubBook): string[] {
  const hrefs: string[] = []
  book.spine?.each?.((section) => {
    if (typeof section.href === 'string' && section.href.trim() !== '') hrefs.push(section.href.trim())
  })
  return hrefs
}

export function createEpubBook(bytes: Uint8Array): EpubBook {
  // 复制一份，既保证拿到独立的 ArrayBuffer（跨进程传来的可能是视图或 SharedArrayBuffer），
  // 也让 epub.js 内部对其做引用计数时不会影响调用方持有的数据。
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return ePub(copy.buffer)
}
