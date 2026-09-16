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

const TOOLBAR_WIDTH = 148
const TOOLBAR_HEIGHT = 34
/** 浮条与选区之间的空隙。 */
const GAP = 8
/** 距容器边缘的最小留白。 */
const EDGE = 8

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

interface SelectionToolbarProps {
  placement: SelectionPlacement
  /** 同一段选区上已经有划线时，主按钮变成删除。 */
  highlighted: boolean
  onHighlight: () => void
  onDismiss: () => void
}

/**
 * 选中文字后弹出的小浮条。只有两个动作：划线（已有则删除）与取消。
 * 笔记输入与配色选择属于 MVP 之外，见设计稿 §5。
 */
export default function SelectionToolbar({
  placement,
  highlighted,
  onHighlight,
  onDismiss
}: SelectionToolbarProps): React.JSX.Element {
  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="选中文字的操作"
      style={{ top: `${placement.top}px`, left: `${placement.left}px` }}
    >
      <button type="button" onClick={onHighlight}>
        {highlighted ? '删除划线' : '划线'}
      </button>
      <button type="button" onClick={onDismiss}>
        取消
      </button>
    </div>
  )
}
