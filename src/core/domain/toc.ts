import { isRecord } from './guards'

export interface TocEntry extends TocItem {
  href: string
}

/**
 * 目录抽屉真正用得到的最小形状。
 *
 * href 是 epub.js 的定位方式（相对导航文档的路径 + 片段），TXT 没有文档可以指，
 * 靠「第几块 + 块内偏移」定位。抽屉只画标签与缩进，所以两种后端在这里汇合，
 * 不必让 TXT 去编一个自己不用的 href。
 */
export interface TocItem {
  /** 列表渲染用的稳定标识；目录项本身可能没有 id，或有多项共用同一个 id。 */
  id: string
  label: string
  /** 嵌套层级，顶层为 0。 */
  depth: number
}

export interface TocLimits {
  maxEntries: number
  maxDepth: number
}

/** 目录是外部数据，必须设上限：畸形 EPUB 可以造出几万个目录项。 */
export const TOC_LIMITS: TocLimits = { maxEntries: 500, maxDepth: 4 }

function cleanLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned === '' ? fallback : cleaned
}

function cleanHref(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function splitFragment(href: string): [string, string] {
  const index = href.indexOf('#')
  return index === -1 ? [href, ''] : [href.slice(0, index), href.slice(index + 1)]
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

/**
 * 把 epub.js 解析出来的目录树摊平成带层级的列表。
 * 层级交给渲染层做缩进，树本身不必再往下传。
 * 没有 href 的项无法跳转，但它的子项仍然有效，所以跳过自身而不是整枝丢弃。
 */
export function flattenToc(raw: unknown, limits: TocLimits = TOC_LIMITS): TocEntry[] {
  const entries: TocEntry[] = []

  function walk(items: unknown, depth: number): void {
    if (!Array.isArray(items) || depth > limits.maxDepth) return

    for (const item of items) {
      if (entries.length >= limits.maxEntries) return
      if (!isRecord(item)) continue

      const href = cleanHref(item.href)
      if (href !== null) {
        entries.push({
          id: `toc-${entries.length}`,
          label: cleanLabel(item.label, baseName(splitFragment(href)[0])),
          href,
          depth
        })
      }

      walk(item.subitems, depth + 1)
    }
  }

  walk(raw, 0)
  return entries
}

/**
 * 目录里的 href 是相对导航文档写的，spine 里的 href 是相对 OPF 写的，
 * 两者目录不同时（例如导航放在 OEBPS/nav/nav.xhtml）就对不上号。
 * 先按原样匹配；匹配不上时退回「文件名唯一命中」，命中不了就原样返回交给 epub.js 报错。
 */
export function resolveTocTarget(entryHref: string, spineHrefs: readonly string[]): string {
  const [path, fragment] = splitFragment(entryHref)
  if (path === '') return entryHref
  if (spineHrefs.includes(path)) return entryHref

  const name = baseName(path)
  const matches = spineHrefs.filter((href) => baseName(splitFragment(href)[0]) === name)
  if (matches.length !== 1) return entryHref

  return fragment === '' ? matches[0]! : `${matches[0]}#${fragment}`
}
