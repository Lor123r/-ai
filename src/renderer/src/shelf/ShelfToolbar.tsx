import type { ShelfFilter, ShelfSort, ShelfView } from '@core/domain/shelfView'

const SORT_OPTIONS: { value: ShelfSort; label: string }[] = [
  { value: 'recent', label: '最近阅读' },
  { value: 'added', label: '导入时间' },
  { value: 'title', label: '书名' },
  { value: 'author', label: '作者' },
  { value: 'progress', label: '阅读进度' }
]

const FILTER_OPTIONS: { value: ShelfFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'reading', label: '在读' },
  { value: 'unread', label: '未开始' },
  { value: 'finished', label: '已读完的' },
  { value: 'epub', label: 'EPUB' },
  { value: 'txt', label: 'TXT' }
]

export interface ShelfToolbarProps {
  view: ShelfView
  onSortChange: (sort: ShelfSort) => void
  onFilterChange: (filter: ShelfFilter) => void
}

/**
 * 用原生 `<select>` 而不是一排按钮：排序 5 项、筛选 6 项，按钮排会占掉一整行
 * 且随选项增加而变宽；原生控件还自带键盘操作与无障碍语义。
 */
export default function ShelfToolbar({
  view,
  onSortChange,
  onFilterChange
}: ShelfToolbarProps): React.JSX.Element {
  return (
    <div className="shelf-toolbar">
      <label className="shelf-toolbar__field">
        <span className="shelf-toolbar__label">排序</span>
        <select
          className="shelf-toolbar__select"
          value={view.sort}
          onChange={(event) => onSortChange(event.target.value as ShelfSort)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="shelf-toolbar__field">
        <span className="shelf-toolbar__label">筛选</span>
        <select
          className="shelf-toolbar__select"
          value={view.filter}
          onChange={(event) => onFilterChange(event.target.value as ShelfFilter)}
        >
          {FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
