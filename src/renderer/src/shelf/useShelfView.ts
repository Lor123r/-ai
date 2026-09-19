import { useCallback, useState } from 'react'
import {
  DEFAULT_SHELF_VIEW,
  type ShelfFilter,
  type ShelfSort,
  type ShelfView
} from '@core/domain/shelfView'

export interface UseShelfViewResult {
  view: ShelfView
  setSort: (sort: ShelfSort) => void
  setFilter: (filter: ShelfFilter) => void
}

/**
 * 书架的排序与筛选偏好。
 *
 * 刻意不落盘：它是「这次想怎么看」，不是内容。落盘要新增一份存储或把书架偏好
 * 塞进语义是「阅读设置」的 settings.json，收益只是「重启后还记得上次选的排序」，
 * 而用户打开应用第一件事是找书，不是确认下拉框还停在「按书名」。
 * 代价是重启后回到默认（最近阅读 / 全部），已写进 README 的当前限制。
 */
export function useShelfView(): UseShelfViewResult {
  const [view, setView] = useState<ShelfView>(DEFAULT_SHELF_VIEW)

  const setSort = useCallback((sort: ShelfSort) => {
    setView((current) => ({ ...current, sort }))
  }, [])

  const setFilter = useCallback((filter: ShelfFilter) => {
    setView((current) => ({ ...current, filter }))
  }, [])

  return { view, setSort, setFilter }
}
