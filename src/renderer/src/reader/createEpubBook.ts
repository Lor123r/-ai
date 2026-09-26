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

/** 章节 iframe 里的选区，只声明我们真正读取的三个成员。 */
export interface EpubSelection {
  /** 折叠成光标时是 0，此时取不到 range，划线按钮没有意义。 */
  rangeCount: number
  toString(): string
  getRangeAt(index: number): { getBoundingClientRect(): DOMRect }
}

/** epub.js 的 Contents，只声明我们真正读取的字段。 */
export interface EpubContents {
  /** iframe 内部的 document。翻页手势要绑到它上面才收得到正文上的点击。 */
  document?: Document
  window?: {
    getSelection?(): EpubSelection | null
    /** iframe 元素自身，用来把 iframe 内部的坐标换算到宿主文档。 */
    frameElement?: { getBoundingClientRect(): DOMRect } | null
  }
}

/**
 * epub.js 的注解图层。只声明我们调用的两个动作，签名与 epub.js 保持一致：
 * `add` 是六参数（第 4 个是点击回调、第 5 个是类名、第 6 个才是样式），
 * 类名留空才会拿到默认的 `epubjs-hl`。
 */
export interface EpubAnnotationLayer {
  add(
    type: string,
    cfiRange: string,
    data?: object,
    callback?: Function,
    className?: string,
    styles?: object
  ): unknown
  remove(cfiRange: string, type: string): void
}

/**
 * rendition 的事件表。epub.js 的事件全是字符串 + 变参，
 * 用映射表收敛成「事件名 → 参数元组」，才能把 `selected` 的第二个参数也带上类型。
 */
export interface EpubRenditionEvents {
  relocated: [location: EpubRelocation]
  selected: [cfiRange: string, contents: EpubContents]
  /**
   * 一节渲染完成。epub.js 传的是 `(section, view)`，view 上挂着这一节的
   * Contents —— 翻页手势要靠它拿到 iframe 内部的 document。
   */
  rendered: [section: unknown, view: { contents?: EpubContents } | undefined]
}

export interface EpubRendition {
  display(target?: string): Promise<unknown>
  next(): Promise<unknown>
  prev(): Promise<unknown>
  on<Event extends keyof EpubRenditionEvents>(
    event: Event,
    handler: (...payload: EpubRenditionEvents[Event]) => void
  ): void
  /** `rendition.js` 在构造时就建好了它，不是可选项。 */
  annotations: EpubAnnotationLayer
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
