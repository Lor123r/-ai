import { TOC_LIMITS, type TocItem } from './toc'

/**
 * TXT 的目录项。
 *
 * 与 EPUB 的 TocEntry 相比，这里没有 href —— TXT 没有导航文档可以指，
 * 定位靠「第几块 + 块内第几个字符」。
 */
export interface TextTocEntry extends TocItem {
  /** 标题所在的块序号。 */
  blockIndex: number
  /**
   * 标题在块内的字符偏移。
   *
   * 一个块里可能住着好几章（章节之间只空了一行、甚至只换了一行），
   * 所以光有块序号不够，还得知道落在块内的哪儿。
   */
  offset: number
}

export interface TextTocLimits {
  maxEntries: number
  /** 标签超过这个长度就截断，避免一句话被当成标题时把抽屉撑变形。 */
  maxLabelChars: number
}

export const TEXT_TOC_LIMITS: TextTocLimits = {
  maxEntries: TOC_LIMITS.maxEntries,
  maxLabelChars: 40
}

/**
 * 「第 X 章 / 节 / 回 / 卷 / 篇 / 部 / 集」，以及几种不编号的开头。
 *
 * 整行匹配（^...$）是刻意的：正文里出现「第一章」多半在句子中间，
 * 只有整行就是标题那种排法才算。分隔符（空格、顿号、冒号）可有可无 ——
 * 「第一章 初见」「第一章：初见」「第一章初见」都要认。
 *
 * 标题正文限 20 字：够收下常见的短标题，又把整段叙述挡在外面（叙述句一定更长）。
 *
 * 只在 matchAll 上用这个 /g 正则：matchAll 会克隆一份并沿用 lastIndex，
 * 而这里从不用 exec 去动原始对象，lastIndex 恒为 0，不会有跨次调用的状态。
 */
const HEADING_LINE =
  /^[ \t]*((?:第[ \t]*(?:[0-9]{1,10}|[零〇一二三四五六七八九十百千两]{1,10})[ \t]*[章节回卷篇部集]|序章|序幕|楔子|引子|前言|序言|后记|尾声|番外|终章)[^\n]{0,20})[ \t]*$/gm

/** 退化模式（无标题可认）只看块首这么多个字符，够拼出一个像样的标签就行。 */
const LABEL_SCAN_CHARS = 200

function positiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  return floored >= 1 ? floored : fallback
}

/** 折叠内部空白并截断。跨行的块首被折成一行，免得标签里带换行。 */
function toLabel(raw: string, maxLabel: number): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  return collapsed.length > maxLabel ? `${collapsed.slice(0, maxLabel)}…` : collapsed
}

/**
 * 从已分好的块里认章节标题。
 *
 * 逐行整行匹配，不做「只认块首」的偷懒：中文 TXT 里章节之间常常只换一行、
 * 不空行，那样整本书就是一个块，只认块首等于只认出一个目录项。
 *
 * 一个标题都认不出来时退化成「按块首列」：至少还能跳段落，比空目录有用。
 */
export function generateTextToc(
  blocks: readonly string[],
  limits: TextTocLimits = TEXT_TOC_LIMITS
): TextTocEntry[] {
  const maxEntries = positiveInt(limits.maxEntries, TEXT_TOC_LIMITS.maxEntries)
  const maxLabel = positiveInt(limits.maxLabelChars, TEXT_TOC_LIMITS.maxLabelChars)

  const headings: TextTocEntry[] = []
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    if (headings.length >= maxEntries) break

    for (const match of (blocks[blockIndex] ?? '').matchAll(HEADING_LINE)) {
      if (headings.length >= maxEntries) break

      const label = toLabel(match[1]!, maxLabel)
      if (label === '') continue

      headings.push({
        id: `txt-toc-${headings.length + 1}`,
        label,
        depth: 0,
        blockIndex,
        offset: match.index ?? 0
      })
    }
  }
  if (headings.length > 0) return headings

  const fallback: TextTocEntry[] = []
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    if (fallback.length >= maxEntries) break

    const label = toLabel((blocks[blockIndex] ?? '').slice(0, LABEL_SCAN_CHARS), maxLabel)
    fallback.push({
      id: `txt-toc-${fallback.length + 1}`,
      label: label === '' ? `第 ${blockIndex + 1} 块` : label,
      depth: 0,
      blockIndex,
      offset: 0
    })
  }
  return fallback
}
