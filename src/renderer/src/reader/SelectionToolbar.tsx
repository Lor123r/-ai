import { HIGHLIGHT_COLORS, type HighlightColor } from '@core/domain/annotation'
import { HIGHLIGHT_COLOR_LABELS, highlightFill } from './highlightPalette'
import type { EpubContents } from './createEpubBook'

/** 视口坐标系下的一个矩形，只要 getBoundingClientRect 的四个字段。 */
export interface RectLike {
  top: number
  left: number
  width: number
  height: number
}

export interface SelectionPlacementInput {
  /** 选区在 iframe 文档里的位置。 */
  selection: RectLike
  /** 承载正文的 iframe 自身在宿主文档里的位置。 */
  frame: RectLike
  /** 浮条的定位容器（阅读区）在宿主文档里的位置。 */
  container: RectLike
}

export interface SelectionPlacement {
  top: number
  left: number
  /** 算出来的位置放不下、只能落回容器顶部时为 true（分页 / 分栏模式下的常见结果）。 */
  fallback: boolean
}

/**
 * 浮条的固定尺寸，导出给测试当唯一事实来源 —— 测试里再抄一遍字面量的话，
 * 改了布局却忘了改测试就会得到一条假绿。
 *
 * 宽度是**由算式推导**的，不是量出来的。六个控件（四色块 + 删除划线 + 取消）之间
 * 共 5 条缝，所以是 `(色块数 + 1) × ITEM_GAP` 而不是 `(色块数 − 1) × ITEM_GAP`：
 *   边框 2 + 内边距 8 + 缝 5×4 + 色块 4×24 + 删除划线 74 + 取消 48 = 248
 * 每个按钮都显式写死 height 且 box-sizing 为 border-box，色块才不会把行高撑变。
 * 「删除划线」四个汉字在 13px 字号下约 52px，加 10px×2 的内边距 ≈ 74px，留了一点余量。
 * 改按钮文案、增删色块或改 ITEM_GAP 时必须同步这条算式，否则 placeSelectionToolbar
 * 的夹取范围会错位 —— 夹错了浮条会溢出容器边缘，E2E 就点不到按钮了。
 */
export const TOOLBAR_WIDTH =
  2 + 8 + (HIGHLIGHT_COLORS.length + 1) * 4 + HIGHLIGHT_COLORS.length * 24 + 74 + 48
export const TOOLBAR_HEIGHT = 34
/** 浮条与选区之间的空隙。与浮条内部的控件间距是两回事，别合并成一个常量。 */
export const GAP = 8
/** 距容器边缘的最小留白。 */
export const EDGE = 8

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * 把选区换算成浮条相对容器的位置。
 *
 * 选区坐标来自 iframe 内部，必须先补上 iframe 自身相对容器的偏移；
 * 分页模式下选区可能贴着容器上沿，上方放不下就翻到选区下方，
 * 上下都放不下（选区被裁掉、rect 全为 0 等）则落回容器顶部固定位置 —— 不做浮层 portal。
 */
export function placeSelectionToolbar(input: SelectionPlacementInput): SelectionPlacement {
  const { selection, frame, container } = input
  const anchorTop = selection.top + frame.top - container.top
  const anchorLeft = selection.left + frame.left - container.left
  const centerX = anchorLeft + selection.width / 2

  let top = anchorTop - TOOLBAR_HEIGHT - GAP
  if (top < EDGE) top = anchorTop + selection.height + GAP

  const fits = top >= EDGE && top + TOOLBAR_HEIGHT <= container.height - EDGE
  const fallback = !fits

  return {
    top: fallback ? EDGE : top,
    left: clamp(centerX - TOOLBAR_WIDTH / 2, EDGE, container.width - TOOLBAR_WIDTH - EDGE),
    fallback
  }
}

/** 从 epub.js 的 Contents 里读出选区位置；取不到选区时返回 null（浮条不弹）。 */
export function selectionPlacement(
  contents: EpubContents,
  container: { getBoundingClientRect(): RectLike }
): SelectionPlacement | null {
  const view = contents.window
  const selection = view?.getSelection?.()
  if (!selection || selection.rangeCount === 0) return null

  // iframe 元素本身也可能取不到（自定义 view 实现），那就无从换算坐标
  const frame = view?.frameElement
  if (!frame) return null

  return placeSelectionToolbar({
    selection: selection.getRangeAt(0).getBoundingClientRect(),
    frame: frame.getBoundingClientRect(),
    container: container.getBoundingClientRect()
  })
}

export interface SelectionToolbarProps {
  placement: SelectionPlacement
  /** 当前选区上已有划线的配色；选区上没有划线时是 null，四个色块都不带选中态。 */
  activeColor: HighlightColor | null
  onPickColor: (color: HighlightColor) => void
  onRemoveHighlight: () => void
  onDismiss: () => void
}

/**
 * 选中文字后弹出的小浮条：四个色块直接定色，选区上已有划线时改色或删掉它。
 *
 * 「删除划线」常驻并用 disabled 表示不可删，而不是按状态换文案 —— 控件个数恒定，
 * 浮条宽度才能是个常量（见 TOOLBAR_WIDTH），定位才不会随状态漂移。
 * 点到当前已经在用的颜色由上层按「零改动零写盘」处理，这里照常派发。
 *
 * 色块的色值走内联样式而不是 CSS 类：十六进制只能在 highlightPalette 里出现一次，
 * 在样式表里再写一份迟早会两边不一致。
 */
export default function SelectionToolbar({
  placement,
  activeColor,
  onPickColor,
  onRemoveHighlight,
  onDismiss
}: SelectionToolbarProps): React.JSX.Element {
  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="选中文字的操作"
      style={{ top: `${placement.top}px`, left: `${placement.left}px` }}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="selection-toolbar__swatch"
          style={{ background: highlightFill(color) }}
          // 可访问名必须显式给出来。色块内部还画着一个「✓」，只靠内容算名字会变成
          // 「✓」；指望 title 兜底也不行，那条回落规则在部分读屏与测试环境里不生效。
          aria-label={HIGHLIGHT_COLOR_LABELS[color]}
          aria-pressed={color === activeColor}
          onClick={() => onPickColor(color)}
        >
          <span className="selection-toolbar__check" aria-hidden="true">
            {color === activeColor ? '✓' : ''}
          </span>
        </button>
      ))}
      <button
        type="button"
        className="selection-toolbar__remove"
        disabled={activeColor === null}
        onClick={onRemoveHighlight}
      >
        删除划线
      </button>
      <button type="button" onClick={onDismiss}>
        取消
      </button>
    </div>
  )
}
