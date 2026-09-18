import type { HighlightColor } from '@core/domain/annotation'

/**
 * 划线配色的唯一归属地：色值与中文名都从这里取。
 *
 * 单独成文件而不是塞进 annotationHighlight.ts，是为了不让纯数据表挂在 epub 适配模块下面 ——
 * 那个模块 `import type` 了 createEpubBook，而 createEpubBook 顶部就是 `import ePub from 'epubjs'`。
 * 一旦有人把它改成引值，浮条与抽屉就会连带把整个 epub.js 拖进自己的依赖图。
 */

/**
 * 配色 → 实际色值。四种颜色都是浅色，靠统一的不透明度（见 annotationHighlight.ts）
 * 保证叠在同一套正文底色上都能看清字。
 */
export function highlightFill(color: HighlightColor): string {
  switch (color) {
    case 'yellow':
      return '#f2c744'
    case 'green':
      return '#4aa96c'
    case 'blue':
      return '#5b8def'
    case 'pink':
      return '#e07aa6'
    default: {
      // 收口：HIGHLIGHT_COLORS 将来加了新配色而这里没补映射时，本行直接编译失败，
      // 而不是让新配色静默地画成默认黄色。
      const unhandled: never = color
      return String(unhandled)
    }
  }
}

/**
 * 配色 → 中文名。色块的可访问名与抽屉的类型标签都用它。
 *
 * 中文文案只能留在渲染层：core 的 HighlightColor 是英文枚举，翻译属于展示，
 * 塞进领域模型会让落盘格式跟着界面语言变。`Record` 同样是收口 —— 漏一种配色就编译失败。
 */
export const HIGHLIGHT_COLOR_LABELS: Record<HighlightColor, string> = {
  yellow: '黄色',
  green: '绿色',
  blue: '蓝色',
  pink: '粉色'
}
