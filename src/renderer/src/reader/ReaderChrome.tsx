import type { CSSProperties, ReactNode, Ref } from 'react'
import { formatPercentLabel } from '@core/domain/progress'
import type { ReaderTheme } from '@core/domain/settings'

export type ReaderPanel = 'none' | 'toc' | 'annotations' | 'settings'

export interface ReaderChromeProps {
  title: string
  theme: ReaderTheme
  status: 'loading' | 'ready' | 'error'
  /** 还没有进度时传 null，此时不渲染百分比。 */
  percent: number | null
  /** 打开失败的原因；有值就渲染错误行。 */
  loadError?: string | null
  /** 非致命提醒（例如「编码可能不对」）；有值就渲染提示行，不阻断阅读。 */
  notice?: string | null
  /** 注解相关的错误文案；有值就渲染注解错误行。 */
  annotationError?: string | null
  panel: ReaderPanel
  onPanelChange: (panel: ReaderPanel) => void
  onClose: () => void
  /** 目录是否不可用（例如这本书一个目录项都没解析出来）。置灰而不是隐藏，免得看着像功能缺失。 */
  tocDisabled?: boolean
  /** 插在「设置」之前的额外按钮（EPUB 的加书签）。 */
  extraActions?: ReactNode
  /** 正文容器的 ref；EPUB 要靠它给选区浮条算坐标。 */
  bodyRef?: Ref<HTMLDivElement>
  onMove: (direction: 'next' | 'prev') => void
  /**
   * 顶栏是否可见。
   *
   * 手机上顶栏要占两行，一直挂着会把正文挤掉一大块。阅读时收起，
   * 点屏幕中间再唤出。桌面窗口够高，调用方直接传 true 即可。
   */
  chromeVisible?: boolean
  /** 正文区域，含抽屉与浮条。 */
  children: ReactNode
  style?: CSSProperties
}

/**
 * 阅读器的表现层外壳：EPUB 与 TXT 两种后端共用同一套 DOM 与类名。
 *
 * 只做「把状态画出来」，不持有任何阅读引擎的引用 —— 两种后端的差异都留在各自的
 * 正文组件里。刻意不抽引擎接口：接口要同时容纳「有注解图层」与「没有注解图层」，
 * 为此引入的联合类型会比它省下的重复更多。
 */
export default function ReaderChrome({
  title,
  theme,
  status,
  percent,
  loadError = null,
  notice = null,
  annotationError = null,
  panel,
  onPanelChange,
  onClose,
  tocDisabled = false,
  extraActions,
  bodyRef,
  onMove,
  chromeVisible = true,
  children,
  style
}: ReaderChromeProps): React.JSX.Element {
  function toggle(target: 'toc' | 'annotations' | 'settings'): void {
    onPanelChange(panel === target ? 'none' : target)
  }

  return (
    <section className="reader" aria-label={`正在阅读《${title}》`} data-theme={theme} style={style}>
      <header className="reader__header" data-visible={chromeVisible}>
        <button type="button" onClick={onClose}>
          返回书架
        </button>
        <button
          type="button"
          aria-expanded={panel === 'toc'}
          disabled={tocDisabled || status !== 'ready'}
          onClick={() => toggle('toc')}
        >
          目录
        </button>
        <button
          type="button"
          aria-expanded={panel === 'annotations'}
          onClick={() => toggle('annotations')}
        >
          注解
        </button>
        {extraActions}
        <button
          type="button"
          aria-expanded={panel === 'settings'}
          disabled={status !== 'ready'}
          onClick={() => toggle('settings')}
        >
          设置
        </button>
        <h1>{title}</h1>
        <span className="reader__status">
          {status === 'loading' ? '正在打开…' : status === 'ready' ? '阅读中' : '打开失败'}
        </span>
        {percent !== null ? (
          <span className="reader__percent" aria-label="阅读进度">
            {formatPercentLabel(percent)}
          </span>
        ) : null}
      </header>
      {loadError !== null ? <p className="reader__error">无法打开本书：{loadError}</p> : null}
      {notice !== null ? (
        <p className="reader__notice" role="status">
          {notice}
        </p>
      ) : null}
      {annotationError !== null ? (
        <p className="reader__annotation-error">{annotationError}</p>
      ) : null}
      <div ref={bodyRef} className="reader__body">
        {children}
      </div>
      {/*
        底栏按钮在手机上默认收起（见 global.css 的窄屏断点），桌面端始终显示。
        保留而不是删掉：桌面鼠标用户需要明确的点击目标，屏幕阅读器与键盘
        Tab 也依赖原生 button。手机上翻页走手势，这两个按钮基本用不到。
      */}
      <footer className="reader__controls" data-visible={chromeVisible}>
        <button type="button" onClick={() => onMove('prev')} disabled={status !== 'ready'}>
          上一页
        </button>
        <button type="button" onClick={() => onMove('next')} disabled={status !== 'ready'}>
          下一页
        </button>
      </footer>
    </section>
  )
}
