import type { Annotation } from '@core/domain/annotation'
import { formatPercentLabel } from '@core/domain/progress'
import type { AnnotationListStatus } from './useBookAnnotations'

interface AnnotationDrawerProps {
  annotations: Annotation[]
  status: AnnotationListStatus
  /** 读不到存档时的文案；有值时说明标注功能本次不可用，不显示空态。 */
  error: string | null
  onSelect: (annotation: Annotation) => void
  onRemove: (annotation: Annotation) => void
  onClose: () => void
}

function kindLabel(annotation: Annotation): string {
  return annotation.kind === 'highlight' ? '划线' : '书签'
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
