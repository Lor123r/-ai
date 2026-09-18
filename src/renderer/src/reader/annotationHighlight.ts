import type { HighlightAnnotation, HighlightColor } from '@core/domain/annotation'
import { highlightFill } from './highlightPalette'
import type { EpubAnnotationLayer } from './createEpubBook'

const HIGHLIGHT_TYPE = 'highlight'

/** 成色统一走不透明度，四种颜色叠在同一套底色上都能看清正文。 */
const HIGHLIGHT_OPACITY = '0.35'

function fill(fillColor: string): Record<string, string> {
  return { fill: fillColor, 'fill-opacity': HIGHLIGHT_OPACITY }
}

/**
 * 配色 → epub.js 的 styles（它会和自带的 fill:yellow / mix-blend-mode:multiply 合并）。
 * 类名刻意不传，统一用 epub.js 默认的 `epubjs-hl`，E2E 才能用 `[ref^="epubjs-hl"]` 断言。
 *
 * 色值来自 highlightPalette，和浮条色块共用同一份，不在这里再写一遍十六进制。
 */
export function highlightStyles(color: HighlightColor): Record<string, string> {
  return fill(highlightFill(color))
}

export interface HighlightSyncer {
  /** 把图层对齐到给定的划线集合，只推差分。 */
  sync(highlights: readonly HighlightAnnotation[]): void
  /** 清掉本 syncer 画过的全部标记并销账。只能用在销毁 rendition 的清理里。 */
  reset(): void
}

interface PaintedHighlight {
  cfi: string
  color: HighlightColor
}

/**
 * 划线图层同步器。
 *
 * 内部按 annotation id 记账，只对「新增 / cfi 或配色变了 / 消失」三种情况动图层：
 * epub.js 的 `add` 会无条件往 DOM 里插新的 SVG mark，同一个 cfi 重复 add 会把
 * `this._annotations` 里的引用覆盖掉、留下永远清不掉的孤儿 mark，所以
 * 「表里已有且 cfi/配色都没变」这种情况必须什么都不做。
 *
 * 同一个 cfi 上出现两条划线同样会踩中上面那条（id 不同、hash 相同），
 * 所以创建路径必须按 cfi 去重 —— 见 ReaderView 里划线按钮的 toggle 语义。
 *
 * 记账表必须与 rendition 实例同生共死：换了 rendition 还留着旧账，
 * 就会对一个新的、没有任何 mark 的图层「表里已有、跳过」，划线直接不出现。
 */
export function createHighlightSyncer(layer: EpubAnnotationLayer): HighlightSyncer {
  const painted = new Map<string, PaintedHighlight>()

  function paint(cfi: string, color: HighlightColor): void {
    layer.add(HIGHLIGHT_TYPE, cfi, undefined, undefined, undefined, highlightStyles(color))
  }

  function erase(cfi: string): void {
    layer.remove(cfi, HIGHLIGHT_TYPE)
  }

  return {
    sync(highlights) {
      const next = new Map<string, PaintedHighlight>()
      for (const highlight of highlights) {
        next.set(highlight.id, { cfi: highlight.cfi, color: highlight.color })
      }

      for (const [id, entry] of painted) {
        const target = next.get(id)
        if (!target) {
          erase(entry.cfi)
          painted.delete(id)
          continue
        }
        if (target.cfi === entry.cfi && target.color === entry.color) continue

        // epub.js 按 cfi 记账，改颜色或改位置都必须先撤掉旧标记再画新的
        erase(entry.cfi)
        paint(target.cfi, target.color)
        painted.set(id, target)
      }

      for (const [id, entry] of next) {
        if (painted.has(id)) continue

        paint(entry.cfi, entry.color)
        painted.set(id, entry)
      }
    },

    reset() {
      for (const entry of painted.values()) erase(entry.cfi)
      painted.clear()
    }
  }
}
