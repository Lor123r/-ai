import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHELF_VIEW } from '@core/domain/shelfView'
import ShelfToolbar from '@renderer/shelf/ShelfToolbar'

afterEach(cleanup)

describe('ShelfToolbar', () => {
  it('渲染排序与筛选两个下拉，默认值来自传入的视图', () => {
    render(
      <ShelfToolbar view={DEFAULT_SHELF_VIEW} onSortChange={() => undefined} onFilterChange={() => undefined} />
    )

    expect(screen.getByRole('combobox', { name: '排序' })).toHaveValue('recent')
    expect(screen.getByRole('combobox', { name: '筛选' })).toHaveValue('all')
  })

  it('下拉里列出全部排序与筛选选项', () => {
    render(
      <ShelfToolbar view={DEFAULT_SHELF_VIEW} onSortChange={() => undefined} onFilterChange={() => undefined} />
    )

    const sort = screen.getByRole('combobox', { name: '排序' })
    expect(Array.from(sort.querySelectorAll('option')).map((node) => node.textContent)).toEqual([
      '最近阅读',
      '导入时间',
      '书名',
      '作者',
      '阅读进度'
    ])

    const filter = screen.getByRole('combobox', { name: '筛选' })
    expect(Array.from(filter.querySelectorAll('option')).map((node) => node.textContent)).toEqual([
      '全部',
      '在读',
      '未开始',
      '已读完的',
      'EPUB',
      'TXT'
    ])
  })

  it('改排序只回调排序，不碰筛选', () => {
    const onSortChange = vi.fn()
    const onFilterChange = vi.fn()
    render(
      <ShelfToolbar view={DEFAULT_SHELF_VIEW} onSortChange={onSortChange} onFilterChange={onFilterChange} />
    )

    fireEvent.change(screen.getByRole('combobox', { name: '排序' }), { target: { value: 'title' } })

    expect(onSortChange).toHaveBeenCalledWith('title')
    expect(onFilterChange).not.toHaveBeenCalled()
  })

  it('改筛选只回调筛选，不碰排序', () => {
    const onSortChange = vi.fn()
    const onFilterChange = vi.fn()
    render(
      <ShelfToolbar view={DEFAULT_SHELF_VIEW} onSortChange={onSortChange} onFilterChange={onFilterChange} />
    )

    fireEvent.change(screen.getByRole('combobox', { name: '筛选' }), { target: { value: 'unread' } })

    expect(onFilterChange).toHaveBeenCalledWith('unread')
    expect(onSortChange).not.toHaveBeenCalled()
  })

  it('受控：显示的是传入视图的值，不是内部状态', () => {
    render(
      <ShelfToolbar
        view={{ sort: 'progress', filter: 'txt' }}
        onSortChange={() => undefined}
        onFilterChange={() => undefined}
      />
    )

    expect(screen.getByRole('combobox', { name: '排序' })).toHaveValue('progress')
    expect(screen.getByRole('combobox', { name: '筛选' })).toHaveValue('txt')
  })
})
