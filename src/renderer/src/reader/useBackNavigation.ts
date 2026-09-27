import { useEffect, useRef } from 'react'

/**
 * 系统返回键（安卓返回键 / 浏览器后退）的接管。
 *
 * 为什么不用 `@capacitor/app` 的 `backButton` 事件：那个事件只在安卓原生宿主里存在，
 * 浏览器宿主（e2e-web 那套）没有，于是同一份代码在两种宿主下行为不同，E2E 也测不到。
 * 走 History API 则两边同一条路径 —— 安卓返回键本来就会触发 `popstate`，
 * 浏览器里 `history.back()` 触发的也是它。
 *
 * ## 为什么是「注册回调」而不是「各自监听 popstate」
 *
 * 一开始的写法是 App 和阅读器各挂一个 `popstate` 监听，靠捕获/冒泡的先后决定谁先处理。
 * **这条路走不通**：`popstate` 派发的目标是 `window` 本身，而事件在**目标节点**上
 * 不区分捕获与冒泡，一律按注册顺序触发。App 先挂载、先注册，于是永远先跑，
 * 它一跑就把阅读器卸载了 —— 阅读器那个监听再想拦已经晚了。
 *
 * 所以改成单一入口：App 挂唯一的 `popstate` 监听，收到后先问阅读器
 * 「这次返回你要不要」，要就交给它，不要才回书架。谁先谁后不再取决于注册顺序。
 *
 * ## 栈的形状
 *
 * ```
 * 书架（无 state）
 *   ↓ 点开书（App 压栈）
 * pushState({ view: 'reader' })
 *   ↓ 按返回键
 * popstate → 阅读器要（抽屉开着）→ 关抽屉 + 补回这一层
 *          → 阅读器不要        → 回书架
 * ```
 *
 * **压栈与出栈必须成对。** 压了栈却不 pop 就离开（比如点顶栏的「返回书架」直接清 state），
 * history 里会留下一条永远回不去的记录：用户按返回键会先「回到阅读器」再「回书架」，
 * 看着像返回键失灵。所以离开阅读器一律走 `history.back()`，由 `popstate` 统一收尾。
 */

/** 压进 history 的 state。带个标记，便于判断当前这条是不是阅读器那一层。 */
export const READER_STATE = { view: 'reader' } as const

export function isReaderState(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && (state as { view?: unknown }).view === 'reader'
  )
}

/**
 * 阅读器登记进来的「这次返回我要不要」回调。
 *
 * 用模块级变量而不是 context：同一时刻只可能有一个阅读器，而 App 的 `popstate`
 * 监听拿不到 React 树里的值。多一层 context 只是把同一个事实换个地方存。
 */
let backInterceptor: (() => boolean) | null = null

/**
 * 阅读器调用：登记「返回键先问我」。
 *
 * `onBack` 返回 `true` 表示「我处理了，别离开阅读器」——抽屉打开时先关抽屉就是这种。
 * 返回 `false` 表示「没我什么事」，交给 App 回书架。
 */
export function useBackNavigation({ onBack }: { onBack: () => boolean }): void {
  // 用 ref 存回调，避免每次渲染都重新登记
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    backInterceptor = () => onBackRef.current()
    return () => {
      backInterceptor = null
    }
  }, [])
}

/**
 * App 调用：处理一次返回键。
 *
 * 返回 `true` 表示阅读器接管了（比如关掉了抽屉），App 什么都不用做；
 * 返回 `false` 表示该回书架了。
 */
export function handleBackPress(): boolean {
  return backInterceptor?.() ?? false
}
