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
  /** 注解相关的错误文案；有值就渲染注解错误行。 */
  annotationError?: string | null
  panel: ReaderPanel
  onPanelChange: (panel: ReaderPanel) => void
  onClose: () => void
  /** 目录是否不可用。TXT 没有导航结构，置灰而不是隐藏，免得看着像功能缺失。 */
  tocDisabled?: boolean
  /** 插在「设置」之前的额外按钮（EPUB 的加书签）。 */
  extraActions?: ReactNode
  /** 正文容器的 ref；EPUB 要靠它给选区浮条算坐标。 */
  bodyRef?: Ref<HTMLDivElement>
  onMove: (direction: 'next' | 'prev') => void
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
  annotationError = null,
  panel,
  onPanelChange,
  onClose,
  tocDisabled = false,
  extraActions,
  bodyRef,
  onMove,
  children,
  style
}: ReaderChromeProps): React.JSX.Element {
  function toggle(target: 'toc' | 'annotations' | 'settings'): void {
    onPanelChange(panel === target ? 'none' : target)
  }

  return (
    <section className="reader" aria-label={`正在阅读《${title}》`} data-theme={theme} style={style}>
      <header className="reader__header">
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
      {annotationError !== null ? (
        <p className="reader__annotation-error">{annotationError}</p>
      ) : null}
      <div ref={bodyRef} className="reader__body">
        {children}
      </div>
      <footer className="reader__controls">
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
