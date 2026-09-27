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

/**
 * 横向位移超过这个像素数才算滑动。
 *
 * 40 是鼠标的合适值，手指不行：手机上拇指划一下的横向位移常常只有二三十像素，
 * 尤其是一边走路一边看的时候。24 是「点歪了」与「想划一下」之间的分界 ——
 * 点击的容差另有 TAP_SLOP 管着，两者不冲突。
 */
const SWIPE_MIN_DISTANCE = 24

/**
 * 滑动时横向位移至少要是纵向的这么多倍，避免斜着划一下就被翻页。
 *
 * 1.5 对手指太严：手指很难走直线，斜着划一下的横纵比常在 1.2 上下，
 * 于是「想翻页」被当成「想滚动」，什么都不发生。1.2 仍然能挡住
 * 明显的纵向滚动（那种横纵比通常小于 0.5）。
 */
const SWIPE_AXIS_RATIO = 1.2

/** 一次滑动最多翻一页：超过这个时间多半是「按住不动」，不是滑动。 */
const SWIPE_MAX_DURATION = 800

/**
 * 点击落在左右这个比例的区域内才算翻页，中间留给「唤出工具栏」。
 *
 * 0.3 时中间死区占 40%，手机上太宽：拇指够不到两侧，点中间又只出工具栏，
 * 于是「翻不动页」。0.4 把死区压到 20%，两侧各留 40% 的翻页区。
 * 这个比例是相对**正文列**算的，不是相对整窗宽 —— 见下面的 rect 计算。
 */
const TAP_ZONE_RATIO = 0.4

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
   * 正文列元素（`.reader__viewport`），点击分区按它的宽度算。
   *
   * 不传时退回 `targetRef` 的容器。桌面端两者宽度差很多：容器是整窗宽
   * （1087px），正文列是 `min(900px, 100%)` 居中（900px，左边距 93px）。
   * 拿整窗宽当分母，正文列中间 70% 会落进死区，点哪儿都不翻页。
   */
  viewportRef?: RefObject<HTMLElement | null>
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
  viewportRef,
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
    // 正文列可能还没挂上（首帧），拿不到就退回容器
    const viewport = viewportRef?.current ?? null

    // 一次手势只处理一次：滑动翻页之后，抬起事件不能再当成点击
    let start: { x: number; y: number; time: number } | null = null
    let consumed = false

    /**
     * 事件来自 iframe 内部时，clientX 相对的是 iframe 自己的视口（epub.js 的
     * paginated 流把它撑成一条很宽的横条），要加上 iframe 元素的 left 偏移
     * 才能换算成屏幕坐标。外层文档的事件偏移为 0。
     */
    function iframeOffsetFor(event: PointerEvent): number {
      if (!innerDocument || innerDocument === document) return 0
      if (event.view !== innerDocument.defaultView) return 0
      const frame = viewport?.querySelector('iframe') ?? container.querySelector('iframe')
      return frame ? frame.getBoundingClientRect().left : 0
    }

    function handlePointerDown(event: PointerEvent): void {
      // 只认主键 / 单指；多指（缩放）不参与翻页
      if (event.button !== 0) return
      // 点在按钮、链接、抽屉上时不接管：那是 UI 自己的点击
      if (isInteractive(event.target)) return
      start = {
        x: event.clientX + iframeOffsetFor(event),
        y: event.clientY,
        time: Date.now()
      }
      consumed = false
    }

    function handlePointerUp(event: PointerEvent): void {
      const origin = start
      start = null
      if (!origin || consumed) return

      // 按下与抬起可能一个在外层文档、一个在 iframe 里，两边 clientX 的坐标系
      // 不同，各自换算到屏幕坐标再相减，否则 dx 是个毫无意义的差值。
      const dx = event.clientX + iframeOffsetFor(event) - origin.x
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
        // 手指往左划（dx < 0）是「下一页」，往右划是「上一页」
        onMoveRef.current(dx < 0 ? 'next' : 'prev')
        return
      }

      // 位移太大就不当点击：斜着划了一下，既不是滑动也不是点击
      if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) return

      // 点击分区按**正文列**算，不按整窗宽算。
      //
      // 外层 `.reader__body` 是整窗宽（桌面 1087px），正文列 `.reader__viewport`
      // 是 `min(900px, 100%)` 居中（900px，左边距 93px）。用户瞄的是正文列，
      // 拿整窗宽当分母的话，正文列中间 70% 会落进死区 —— 点哪儿都不翻页。
      //
      // **iframe 里的 clientX 不在同一个坐标系里。** epub.js 的 paginated 流把
      // 整章排成一条很宽的横条（真机上是 7400px），靠横向滚动一次露一栏，
      // 由 `.reader__viewport` 的 overflow: hidden 裁掉其余部分。于是 iframe
      // 内部的 clientX 是相对那条 7400px 视口的，还带着滚动偏移；外层文档的
      // clientX 才是相对屏幕的。两者混用会让 ratio 恒大于 1，点哪儿都判成「下一页」。
      //
      // 统一到屏幕坐标：iframe 事件加上 iframe 元素的 left 偏移。
      const rect = (viewport ?? container).getBoundingClientRect()
      if (rect.width === 0) return
      const screenX = event.clientX + iframeOffsetFor(event)
      const ratio = (screenX - rect.left) / rect.width

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
  }, [targetRef, viewportRef, innerDocument, disabled])
}
