import type {
  BookmarkAnnotation,
  HighlightAnnotation,
  HighlightColor
} from '@core/domain/annotation'
import { highlightFill } from './highlightPalette'
import type { EpubAnnotationLayer } from './createEpubBook'

/**
 * 两个同步器共用同一个图层，只能靠 type 字符串隔离 —— epub.js 的注解 hash 是
 * `encodeURI(cfi + type)`，所以同一条 cfi 上的划线（`highlight`）与书签标记（`mark`）
 * 是两条互不干涉的注解。两个常量各自定义、不得复用：一旦相等，书签的 remove 会把
 * 同一条 cfi 上的划线一起摘掉。
 */
const HIGHLIGHT_TYPE = 'highlight'

/** epub.js 的原生 mark 类型：专为折叠 range 设计，`highlight` 类型在折叠 range 上量不出矩形。 */
export const BOOKMARK_MARK_TYPE = 'mark'

/** `data` 的每个 key 都写进 dataset 属性，样式与 E2E 都靠它锚定，不与线下的 mark 混同。 */
export const BOOKMARK_MARK_DATA = Object.freeze({ bookmark: 'true' as const })

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

/**
 * 把图层的「抛」收敛成返回值。
 *
 * epub.js 的 `Annotations.add` 第一句就是 `new EpubCFI(cfiRange)`，而 core 刻意不校验
 * CFI 语法（存档可能来自手改或后续的导入功能），非法字符串会抛 TypeError，并把调用方
 * —— React 的同步 effect —— 整条打挂。调用方据此决定要不要记账：没记的下一轮会重试。
 *
 * 只包 add：`unmark` 与 `Annotations.remove` 都有成员判断、且都不解析 CFI，永不抛。
 */
function tryPaint(action: () => void): boolean {
  try {
    action()
    return true
  } catch {
    return false
  }
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

  function paint(cfi: string, color: HighlightColor): boolean {
    return tryPaint(() =>
      layer.add(HIGHLIGHT_TYPE, cfi, undefined, undefined, undefined, highlightStyles(color))
    )
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
        // 画不上就不记账，下一轮 sync 会把它当新条目重试 —— 记了账就等于永久丢失
        if (paint(target.cfi, target.color)) painted.set(id, target)
      }

      for (const [id, entry] of next) {
        if (painted.has(id)) continue

        if (paint(entry.cfi, entry.color)) painted.set(id, entry)
      }
    },

    reset() {
      for (const entry of painted.values()) erase(entry.cfi)
      painted.clear()
    }
  }
}

export interface BookmarkMarkSyncer {
  /** 把图层对齐到给定的书签集合，只推差分。 */
  sync(bookmarks: readonly BookmarkAnnotation[]): void
  /** 清掉本 syncer 画过的全部标记并销账。只能用在销毁 rendition 的清理里。 */
  reset(): void
}

/**
 * 书签标记图层同步器 —— 与 createHighlightSyncer 并列，共用图层但互不认识。
 *
 * 记账键是 **cfi** 而不是 annotation id。epub.js 的 marks 表按 cfi 索引、`mark()` 又幂等，
 * 所以同一 cfi 上的多条书签只对应一枚 DOM 标记：按 id 记账的话，删掉其中一条会
 * `remove(cfi, 'mark')` 把共用的那枚摘掉，而幸存的条目仍被当成「已经画过」、永远不再补画。
 * 按 cfi 记账天然得到正确的折叠语义 —— 删到一条不剩时才真正 remove。
 *
 * 与划线同步器一样，记账表必须与 rendition 实例同生共死：换了 rendition 还留着旧账，
 * 新图层就会被误判成「已经画过」，标记直接不出现。
 *
 * 书签没有配色，所以「已在表里」就是零操作，不存在划线那边的改色分支。
 */
export function createBookmarkMarkSyncer(layer: EpubAnnotationLayer): BookmarkMarkSyncer {
  const painted = new Set<string>()

  return {
    sync(bookmarks) {
      const next = new Set(bookmarks.map((bookmark) => bookmark.cfi))

      for (const cfi of painted) {
        if (next.has(cfi)) continue

        // 这条 cfi 上已经没有书签了，摘掉标记再销账
        layer.remove(cfi, BOOKMARK_MARK_TYPE)
        painted.delete(cfi)
      }

      for (const cfi of next) {
        if (painted.has(cfi)) continue

        // 非法 cfi 会被图层拒绝，跳过并留给下一轮重试
        if (tryPaint(() => layer.add(BOOKMARK_MARK_TYPE, cfi, BOOKMARK_MARK_DATA))) {
          painted.add(cfi)
        }
      }
    },

    reset() {
      for (const cfi of painted) layer.remove(cfi, BOOKMARK_MARK_TYPE)
      painted.clear()
    }
  }
}
