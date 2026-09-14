import { flattenToc, resolveTocTarget, type TocEntry } from '@core/domain/toc'
import { spineHrefs, type EpubBook } from './createEpubBook'

/**
 * 读出可直接渲染与跳转的目录。
 * 必须在 book.ready 之后调用，那时 epub.js 才把导航解析完。
 */
export function readToc(book: EpubBook): TocEntry[] {
  const entries = flattenToc(book.navigation?.toc)
  if (entries.length === 0) return entries

  const hrefs = spineHrefs(book)
  if (hrefs.length === 0) return entries

  return entries.map((entry) => ({ ...entry, href: resolveTocTarget(entry.href, hrefs) }))
}
