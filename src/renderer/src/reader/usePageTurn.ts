import { useEffect, useRef, type RefObject } from 'react'

/**
 * 正文区的翻页手势：左右滑动 + 点击屏幕左右两侧。
 *
 * 为什么放在这里而不是各自的正文组件里：EPUB 与 TXT 的翻页语义完全一样
 * （都是「上一页 / 下一页」），差别只在正文怎么渲染。手势属于交互层，
 * 两种后端共用一份实现，免得改了一边忘了另一边。
 *
 * **必须同时绑两层。** EPUB 的正文在 iframe 里，父文档上的监听收不到
 * iframe 内部的 pointer 事件；只绑外层的话，点在正文上毫无反应。
 * 所以外层容器与 iframe 的 document 各绑一份，共用同一套判定。
 *
 * 三条不能省的规则：
 *
 * 1. **滑动优先于点击。** 手指按下到抬起之间只要横向移动超过阈值就算滑动，
 *    抬起时不再触发点击翻页 —— 否则一次滑动会翻两页。
 * 2. **纵向滑动不算翻页。** 手机上手指很难走直线，横向位移必须明显大于纵向，
 *    否则用户想上下滚一点就被翻页。
 * 3. **有选区时不翻页。** 长按选词、拖动选择手柄都会产生 pointer 事件，
 *    这时候翻页会把用户正在划的句子弄丢。
 */

/** 横向位移超过这个像素数才算滑动。太小会把「点歪了」误判成滑动。 */
const SWIPE_MIN_DISTANCE = 40

/** 滑动时横向位移至少要是纵向的这么多倍，避免斜着划一下就被翻页。 */
const SWIPE_AXIS_RATIO = 1.5

/** 一次滑动最多翻一页：超过这个时间多半是「按住不动」，不是滑动。 */
const SWIPE_MAX_DURATION = 800

/** 点击落在左右这个比例的区域内才算翻页，中间留给「唤出工具栏」。 */
const TAP_ZONE_RATIO = 0.3

/** 位移超过这个像素数就不当点击处理（斜着划了一下，既不是滑动也不是点击）。 */
const TAP_SLOP = 10

/**
 * 手势要放行的元素：落在这些元素上的按下不参与翻页。
 *
 * 监听绑在整个 document 上，所以点顶栏按钮、点抽屉里的目录项、点选区浮条
 * 都会走到这里。不排除的话，点「下一页」按钮会先翻页、再被当成点击中间区
 * 把顶栏收起来 —— 按钮看着像失灵了。
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[contenteditable="true"]',
  '.reader__header',
  '.reader__controls',
  '.reader__drawer',
  '.reader__selection-toolbar'
].join(',')

/** 事件目标是否落在交互元素里（含 iframe 内部）。 */
function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(INTERACTIVE_SELECTOR) !== null
}

export interface UsePageTurnOptions {
  /** 手势挂载的外层容器。 */
  targetRef: RefObject<HTMLElement | null>
  /**
   * EPUB 正文所在的 iframe document。
   *
   * 传 null 表示正文不在 iframe 里（TXT 就是这种），只绑外层。
   * 每次翻页 epub.js 会换掉 iframe，所以这个值变化时要重新绑定。
   */
  innerDocument?: Document | null
  /** 翻页回调；与底部按钮走的是同一个 move。 */
  onMove: (direction: 'next' | 'prev') => void
  /** 点击屏幕中间时触发，用来唤出 / 收起工具栏。 */
  onToggleChrome: () => void
  /** 为 true 时整个手势层停用（例如还没加载完）。 */
  disabled?: boolean
}

/**
 * 把翻页手势绑到容器上。
 *
 * 用 pointer 事件而不是 touch：pointer 同时覆盖触摸、鼠标与触控笔，
 * 桌面端也能用鼠标拖拽翻页，不必写两套。
 */
export function usePageTurn({
  targetRef,
  innerDocument = null,
  onMove,
  onToggleChrome,
  disabled = false
}: UsePageTurnOptions): void {
  // 用 ref 存回调，避免每次渲染都重新绑定监听
  const onMoveRef = useRef(onMove)
  const onToggleChromeRef = useRef(onToggleChrome)
  onMoveRef.current = onMove
  onToggleChromeRef.current = onToggleChrome

  useEffect(() => {
    const target = targetRef.current
    if (!target || disabled) return
    // 收窄成非空常量，闭包里才拿得到非空类型
    const container: HTMLElement = target

    // 一次手势只处理一次：滑动翻页之后，抬起事件不能再当成点击
    let start: { x: number; y: number; time: number } | null = null
    let consumed = false

    function handlePointerDown(event: PointerEvent): void {
      // 只认主键 / 单指；多指（缩放）不参与翻页
      if (event.button !== 0) return
      // 点在按钮、链接、抽屉上时不接管：那是 UI 自己的点击
      if (isInteractive(event.target)) return
      start = { x: event.clientX, y: event.clientY, time: Date.now() }
      consumed = false
    }

    function handlePointerUp(event: PointerEvent): void {
      const origin = start
      start = null
      if (!origin || consumed) return

      const dx = event.clientX - origin.x
      const dy = event.clientY - origin.y
      const elapsed = Date.now() - origin.time

      // 有选区时不翻页：用户正在选词，翻页会把选区弄丢
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return

      const isSwipe =
        Math.abs(dx) >= SWIPE_MIN_DISTANCE &&
        Math.abs(dx) >= Math.abs(dy) * SWIPE_AXIS_RATIO &&
        elapsed <= SWIPE_MAX_DURATION

      if (isSwipe) {
        consumed = true
        // 向左划（dx < 0）看下一页，与纸质书翻页方向一致
        onMoveRef.current(dx < 0 ? 'next' : 'prev')
        return
      }

      // 位移太大但不是滑动（比如斜着划），不当点击处理
      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) return

      // 用外层容器的宽度算分区：iframe 里的 clientX 也是视口坐标，
      // 两者同一个坐标系，可以直接比。
      const rect = container.getBoundingClientRect()
      if (rect.width === 0) return
      const ratio = (event.clientX - rect.left) / rect.width

      consumed = true
      if (ratio <= TAP_ZONE_RATIO) {
        onMoveRef.current('prev')
      } else if (ratio >= 1 - TAP_ZONE_RATIO) {
        onMoveRef.current('next')
      } else {
        onToggleChromeRef.current()
      }
    }

    function handlePointerCancel(): void {
      start = null
      consumed = false
    }

    const bound: Document[] = [document]
    if (innerDocument && innerDocument !== document) bound.push(innerDocument)

    for (const doc of bound) {
      doc.addEventListener('pointerdown', handlePointerDown)
      doc.addEventListener('pointerup', handlePointerUp)
      doc.addEventListener('pointercancel', handlePointerCancel)
    }

    return () => {
      for (const doc of bound) {
        doc.removeEventListener('pointerdown', handlePointerDown)
        doc.removeEventListener('pointerup', handlePointerUp)
        doc.removeEventListener('pointercancel', handlePointerCancel)
      }
    }
  }, [targetRef, innerDocument, disabled])
}
