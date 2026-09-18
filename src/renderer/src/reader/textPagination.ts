/**
 * TXT 的分页数学。刻意抽成纯函数：jsdom 里 scrollWidth / clientWidth 恒为 0，
 * 分页算术放在组件里就只剩「文本渲染出来了」可断言，抽出来才能真正被测到。
 *
 * 排布方式沿用 CSS 多栏：容器宽 W、栏间距 gap，每一栏正好占 W，栏与栏之间留 gap。
 * 于是第 n 栏的横向偏移是 -(n-1) * (W + gap)，总栏数由内容宽度反算。
 */

/** 栏间距取页边距的两倍，让相邻两栏的文字间距等于四周边距，观感才统一。 */
export const COLUMN_GAP_FACTOR = 2

/** 一栏的步进宽度：栏宽加栏间距。clientWidth 为 0（未排版/测试环境）时按 1 算，避免除零。 */
export function columnStep(clientWidth: number, pageMargin: number): number {
  const width = Number.isFinite(clientWidth) && clientWidth > 0 ? clientWidth : 0
  const margin = Number.isFinite(pageMargin) && pageMargin > 0 ? pageMargin : 0
  return Math.max(1, Math.round(width + margin * COLUMN_GAP_FACTOR))
}

/** 栏间距，与 columnStep 必须用同一个换算，否则总栏数会算多一栏。 */
export function columnGap(pageMargin: number): number {
  const margin = Number.isFinite(pageMargin) && pageMargin > 0 ? pageMargin : 0
  return Math.round(margin * COLUMN_GAP_FACTOR)
}

/**
 * 由内容总宽反算总栏数。
 * 最后一栏右边不留 gap，所以先把 contentWidth 补上一个 gap 再除以步进，
 * 否则「内容正好占满两栏」会被算成 3 栏。
 */
export function totalPagesFromScroll(contentWidth: number, step: number, gap: number): number {
  const content = Number.isFinite(contentWidth) && contentWidth > 0 ? contentWidth : 0
  const safeGap = Number.isFinite(gap) && gap > 0 ? gap : 0
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1
  return Math.max(1, Math.round((content + safeGap) / safeStep))
}

/** 第 page 栏该平移多少像素；page 越界时夹回 [1, totalPages]。 */
export function offsetForPage(page: number, step: number, totalPages: number): number {
  const total = Number.isFinite(totalPages) ? Math.max(1, Math.floor(totalPages)) : 1
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1
  const raw = Number.isFinite(page) ? Math.round(page) : 1
  const clamped = Math.min(Math.max(raw, 1), total)
  const offset = -(clamped - 1) * safeStep
  // 第一页时 -0 与 0 在 CSS 里等价，但返回值是 -0 会让调用方的断言要额外小心
  return offset === 0 ? 0 : offset
}

/** 当前页取值域收敛，设置变化或窗口缩放后页码可能越界。 */
export function clampPage(page: number, totalPages: number): number {
  const total = Number.isFinite(totalPages) ? Math.max(1, Math.floor(totalPages)) : 1
  const raw = Number.isFinite(page) ? Math.round(page) : 1
  return Math.min(Math.max(raw, 1), total)
}
