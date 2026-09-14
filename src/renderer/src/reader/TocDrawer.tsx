import type { TocEntry } from '@core/domain/toc'

interface TocDrawerProps {
  entries: TocEntry[]
  onSelect: (entry: TocEntry) => void
  onClose: () => void
}

/** 目录抽屉。层级用缩进表达，不额外做折叠展开——MVP 的目录通常一屏就够。 */
export default function TocDrawer({ entries, onSelect, onClose }: TocDrawerProps): React.JSX.Element {
  return (
    <aside className="reader__drawer" aria-label="目录">
      <div className="reader__drawer-header">
        <h2>目录</h2>
        <button type="button" onClick={onClose}>
          关闭目录
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="reader__drawer-empty">这本书没有提供目录</p>
      ) : (
        <ul className="toc-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="toc-list__item"
                style={{ paddingLeft: `${12 + entry.depth * 16}px` }}
                title={entry.label}
                onClick={() => onSelect(entry)}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
