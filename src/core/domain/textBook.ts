import { clampPercent, type ReadingLocator } from './progress'

/**
 * 单个文本块的字数上限。块是 TXT 的「章节」：块数当 spineCount，块内页当 page，
 * 于是 progress.ts 的「章节 + 页码」模型可以直接复用，core 一行都不用改。
 *
 * 取 20 万字符：一篇网文章节通常几千字，一部长篇的一「卷」也很少超过十万。
 * 块再大就会让一次排版（CSS 多栏要量 scrollWidth）明显卡顿。
 */
export const TEXT_BLOCK_MAX_CHARS = 200_000

/**
 * TXT 正文的字节上限。书库单文件上限是 512MB，但 EPUB 由 epub.js 流式处理，
 * TXT 却要一次解码成字符串再排版 —— 不设这道闸，超大文件会把渲染进程打满。
 * 16MB 的 UTF-8 中文约合 500 万字，远超任何单本书。
 */
export const MAX_TEXT_BYTES = 16 * 1024 * 1024

/** 换行归一化：`\r\n` 与 `\r` 都归成 `\n`，否则「空行分段」在 Windows 文件上会判错。 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** 空行（允许行内只有空格与制表符）连续出现一次以上算一个段落边界。 */
const PARAGRAPH_BREAK = /(?:\n[ \t]*){2,}/

/** 只削 ASCII 空白，不动全角空格：中文 TXT 常常用全角空格做首行缩进。 */
function trimAsciiLineEdges(text: string): string {
  return text.replace(/^[ \t\n]+/, '').replace(/[ \t\n]+$/, '')
}

/**
 * 把一段文本按行装进不超过 limit 的块里。
 * 优先在行边界切；单行本身就超限时按字符硬切 —— 宁可切坏一个超长行，
 * 也不能产出一个超出上限的块，否则排版那一步会卡死。
 */
function packLines(lines: string[], limit: number): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let currentLength = 0

  function flush(): void {
    const block = trimAsciiLineEdges(current.join('\n'))
    if (block !== '') blocks.push(block)
    current = []
    currentLength = 0
  }

  for (const line of lines) {
    let rest = line
    while (rest.length > limit) {
      // 超长行先把手上的装完，再按 limit 硬切
      flush()
      blocks.push(rest.slice(0, limit))
      rest = rest.slice(limit)
    }

    const added = currentLength === 0 ? rest.length : rest.length + 1
    if (currentLength + added > limit) flush()
    if (rest === '') continue

    current.push(rest)
    currentLength = currentLength === 0 ? rest.length : currentLength + 1 + rest.length
  }

  flush()
  return blocks
}

/**
 * 把解码后的正文切成块。
 * 先按空行分段（保住「一章一块」的自然边界），再把过长的段落打包/硬切成不超限的块。
 * 全空白文本返回空数组而不是一个空块：0 块让调用方直接走「空文件」提示。
 */
export function splitTextIntoBlocks(text: string, limit: number = TEXT_BLOCK_MAX_CHARS): string[] {
  // 非有限的上限（NaN / Infinity）按默认值处理：NaN 会让下面所有比较都恒假，
  // 于是整个文件只要一行就永远不切块 —— 与其产出超限的块，不如回落到默认上限。
  const size = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : TEXT_BLOCK_MAX_CHARS
  const normalized = normalizeNewlines(text)
  if (normalized.trim() === '') return []

  const blocks: string[] = []
  for (const paragraph of normalized.split(PARAGRAPH_BREAK)) {
    const trimmed = trimAsciiLineEdges(paragraph)
    if (trimmed === '') continue
    if (trimmed.length <= size) {
      blocks.push(trimmed)
      continue
    }
    blocks.push(...packLines(trimmed.split('\n'), size))
  }

  return blocks
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.round(value), min), max)
}

/**
 * 由存档的进度反解「块内第几页」。
 *
 * EPUB 靠 cfi 回到原页，TXT 没有 cfi：只按 chapterIndex 打开只会落在块首，
 * 重算出的 percent 比存档值小，用户看到的是「读了一半，重开退回块开头」。
 * 这里把块内页从 percent 反解回来：
 *
 *   percent = (blockIndex + (page - 1) / (totalPages - 1)) / blockCount
 *
 * 四舍五入会带来极小的往返误差，所以调用方比对进度时要用容差而不是逐字相等。
 * 块内只有一页时（totalPages <= 1）比例项恒为 0，反解无意义，直接给第 1 页。
 */
export function blockPageFromLocator(
  locator: Pick<ReadingLocator, 'percent' | 'chapterIndex'>,
  blockCount: number,
  totalPages: number
): number {
  const total = clampInteger(totalPages, 1, Number.MAX_SAFE_INTEGER)
  if (total <= 1) return 1

  const blocks = clampInteger(blockCount, 0, Number.MAX_SAFE_INTEGER)
  if (blocks <= 0) return 1

  const index = locator.chapterIndex === null ? 0 : clampInteger(locator.chapterIndex, 0, blocks - 1)
  const fraction = clampPercent(clampPercent(locator.percent) * blocks - index)
  return clampInteger(fraction * (total - 1) + 1, 1, total)
}
