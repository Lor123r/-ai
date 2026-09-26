import { useCallback, useState } from 'react'

/**
 * 窄屏断点，与 global.css 里收起顶栏/底栏的 `@media (max-width: 600px)` 必须一致。
 *
 * 两处写同一个数字是刻意的：CSS 负责「收起时长什么样」，这里负责「一开始收不收」。
 * 改一处忘了另一处，表现是「手机上顶栏默认挂着」或「桌面上顶栏默认没了」，
 * 两种都不会报错，只会让人看着别扭。E2E 里两条断言分别盯着这两侧。
 */
export const NARROW_VIEWPORT_MAX_WIDTH = 600

/** 当前视口是不是窄屏（手机竖屏）。 */
function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= NARROW_VIEWPORT_MAX_WIDTH
}

/**
 * 顶栏/底栏的显隐状态。
 *
 * 手机上默认收起：顶栏要占两行（五个按钮 + 状态 + 标题），底栏再占一行，
 * 加起来吃掉近三分之一屏。桌面窗口够高，默认展开，鼠标用户不必先点一下才看得到按钮。
 *
 * 初始值只在挂载时算一次，之后不再跟随窗口尺寸变化 —— 用户手动收起/展开过之后，
 * 旋转屏幕或拖动窗口不该把它重置回去。
 */
export function useChromeVisibility(): {
  chromeVisible: boolean
  toggleChrome: () => void
} {
  const [chromeVisible, setChromeVisible] = useState(() => !isNarrowViewport())
  const toggleChrome = useCallback(() => setChromeVisible((visible) => !visible), [])
  return { chromeVisible, toggleChrome }
}
