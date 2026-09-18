import type { Annotation } from '@core/domain/annotation'
import { formatPercentLabel } from '@core/domain/progress'
import { HIGHLIGHT_COLOR_LABELS } from './highlightPalette'
import type { AnnotationListStatus } from './useBookAnnotations'

interface AnnotationDrawerProps {
  annotations: Annotation[]
  status: AnnotationListStatus
  /** 读不到存档时的文案；有值时说明标注功能本次不可用，不显示空态。 */
  error: string | null
  /** 这次运行有没有交换能力。没有（浏览器预览）就整个不渲染导出导入那一行。 */
  canTransfer: boolean
  /** 最近一次导出 / 导入的结果文案。 */
  transferResult: string | null
  onExport: () => void
  onImport: () => void
  onSelect: (annotation: Annotation) => void
  onRemove: (annotation: Annotation) => void
  onClose: () => void
}

/**
 * 列表里的类型标签。划线带上配色名（「绿色划线」），因为换色后列表上光看摘录
 * 看不出正文里到底是哪一种颜色，删错一条的概率就上来了。
 */
function kindLabel(annotation: Annotation): string {
  return annotation.kind === 'highlight'
    ? `${HIGHLIGHT_COLOR_LABELS[annotation.color]}划线`
    : '书签'
}

/** 列表条目的可见文案：有摘录就用摘录，否则用「进度 + 类型」占位，绝不留空白按钮。 */
function describe(annotation: Annotation): string {
  if (annotation.kind === 'highlight' && annotation.excerpt !== '') return annotation.excerpt

  return `${formatPercentLabel(annotation.percent)} 处的${kindLabel(annotation)}`
}

/**
 * 注解列表抽屉：书签与划线放在一起，每条都能跳回原文或删掉。
 * 没有它的话划线划下去就没有任何删除入口，书签的 toggle 也只能在同一页上生效。
 */
export default function AnnotationDrawer({
  annotations,
  status,
  error,
  canTransfer,
  transferResult,
  onExport,
  onImport,
  onSelect,
  onRemove,
  onClose
}: AnnotationDrawerProps): React.JSX.Element {
  return (
    <aside className="reader__drawer" aria-label="注解">
      <div className="reader__drawer-header">
        <h2>注解</h2>
        <button type="button" onClick={onClose}>
          关闭注解
        </button>
      </div>
      {canTransfer ? (
        <div className="reader__drawer-transfer">
          {/*
            列表为空时禁用导出而不是隐藏：按钮还在，用户就知道这个能力存在，
            只是现在没东西可导。hide 掉会让人以为导出功能没做。
          */}
          <button type="button" onClick={onExport} disabled={annotations.length === 0}>
            导出注解
          </button>
          <button type="button" onClick={onImport}>
            导入注解
          </button>
          {transferResult === null ? null : (
            <p className="reader__drawer-notice">{transferResult}</p>
          )}
        </div>
      ) : null}
      {error !== null ? (
        <p className="reader__drawer-empty">{error}</p>
      ) : status === 'loading' ? (
        <p className="reader__drawer-empty">正在载入注解…</p>
      ) : annotations.length === 0 ? (
        <p className="reader__drawer-empty">还没有书签或划线</p>
      ) : (
        <ul className="annotation-list">
          {annotations.map((annotation) => (
            <li key={annotation.id} className="annotation-list__item">
              <span className="annotation-list__kind">{kindLabel(annotation)}</span>
              <button
                type="button"
                className="annotation-list__jump"
                title={annotation.chapterHref === '' ? undefined : annotation.chapterHref}
                onClick={() => onSelect(annotation)}
              >
                {describe(annotation)}
              </button>
              <span className="annotation-list__meta">{formatPercentLabel(annotation.percent)}</span>
              <button
                type="button"
                className="annotation-list__remove"
                aria-label={`删除 ${describe(annotation)}`}
                onClick={() => onRemove(annotation)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
