import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createBookmark, createHighlight, type Annotation } from '@core/domain/annotation'
import AnnotationDrawer from '@renderer/reader/AnnotationDrawer'

function bookmark(id: string, percent: number, chapterHref = ''): Annotation {
  return createBookmark({ id, bookId: 'book-1', cfi: `epubcfi(/6/${id})`, percent, chapterHref }, 0)
}

function highlight(id: string, excerpt: string, percent: number): Annotation {
  return createHighlight({ id, bookId: 'book-1', cfi: `epubcfi(/6/${id})`, excerpt, percent }, 0)
}

/** 除被测字段外用默认值补齐，避免每条用例都重复写一遍无关参数。 */
function renderDrawer(overrides: Partial<Parameters<typeof AnnotationDrawer>[0]> = {}): {
  container: HTMLElement
  onSelect: ReturnType<typeof vi.fn>
  onRemove: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  onExport: ReturnType<typeof vi.fn>
  onImport: ReturnType<typeof vi.fn>
} {
  const onSelect = vi.fn()
  const onRemove = vi.fn()
  const onClose = vi.fn()
  const onExport = vi.fn()
  const onImport = vi.fn()
  const { container } = render(
    <AnnotationDrawer
      annotations={[]}
      status="ready"
      error={null}
      canTransfer={false}
      transferResult={null}
      onExport={onExport}
      onImport={onImport}
      onSelect={onSelect}
      onRemove={onRemove}
      onClose={onClose}
      {...overrides}
    />
  )

  return { container, onSelect, onRemove, onClose, onExport, onImport }
}

describe('AnnotationDrawer', () => {
  it('没有注解时给出空态', () => {
    renderDrawer()

    expect(screen.getByRole('complementary', { name: '注解' })).toBeInTheDocument()
    expect(screen.getByText('还没有书签或划线')).toBeInTheDocument()
  })

  it('载入中给出载入态，而不是空态', () => {
    renderDrawer({ status: 'loading' })

    expect(screen.getByText('正在载入注解…')).toBeInTheDocument()
    expect(screen.queryByText('还没有书签或划线')).not.toBeInTheDocument()
  })

  it('读不到存档时错误态压过空态，不把「读失败」说成「没有注解」', () => {
    renderDrawer({ status: 'error', error: '这会儿读不到这本书的注解' })

    expect(screen.getByText('这会儿读不到这本书的注解')).toBeInTheDocument()
    expect(screen.queryByText('还没有书签或划线')).not.toBeInTheDocument()
  })

  it('书签与划线放在同一张列表里，各带类型标签', () => {
    renderDrawer({ annotations: [bookmark('a', 0.2), highlight('b', '一句摘录', 0.75)] })

    expect(screen.getByText('书签')).toBeInTheDocument()
    expect(screen.getByText('黄色划线')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一句摘录' })).toBeInTheDocument()
  })

  it('没有摘录的条目用「进度 + 类型」占位，不留空白按钮', () => {
    renderDrawer({ annotations: [bookmark('a', 0.2), highlight('b', '', 0.75)] })

    expect(screen.getByRole('button', { name: '20% 处的书签' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '75% 处的黄色划线' })).toBeInTheDocument()
  })

  it('删除按钮的无障碍名带上条目文案，多条列表里也分得清', () => {
    renderDrawer({ annotations: [bookmark('a', 0.2), highlight('b', '一句摘录', 0.75)] })

    expect(screen.getByRole('button', { name: '删除 20% 处的书签' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除 一句摘录' })).toBeInTheDocument()
  })

  it('点击条目跳转原文，点击删除只删不跳', () => {
    const annotations = [bookmark('a', 0.2)]
    const { onSelect, onRemove } = renderDrawer({ annotations })

    fireEvent.click(screen.getByRole('button', { name: '20% 处的书签' }))
    expect(onSelect).toHaveBeenCalledWith(annotations[0])
    expect(onRemove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '删除 20% 处的书签' }))
    expect(onRemove).toHaveBeenCalledWith(annotations[0])
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('有关联章节时把它挂在 title 上做提示，没有就不挂空标题', () => {
    renderDrawer({ annotations: [bookmark('a', 0.2, 'ch1.xhtml'), bookmark('b', 0.4)] })

    expect(screen.getByRole('button', { name: '20% 处的书签' })).toHaveAttribute('title', 'ch1.xhtml')
    expect(screen.getByRole('button', { name: '40% 处的书签' })).not.toHaveAttribute('title')
  })

  it('关闭按钮回调', () => {
    const { onClose } = renderDrawer()

    fireEvent.click(screen.getByRole('button', { name: '关闭注解' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('按传入顺序渲染，不自己再排一遍', () => {
    renderDrawer({ annotations: [highlight('z', '后面的', 0.9), bookmark('a', 0.1)] })

    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('后面的')
    expect(items[1]).toHaveTextContent('10% 处的书签')
  })

  it('这次运行没有交换能力时，整块导出导入都不出现', () => {
    renderDrawer({ canTransfer: false })

    expect(screen.queryByRole('button', { name: '导出注解' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入注解' })).not.toBeInTheDocument()
  })

  it('有交换能力时给出导出与导入两个入口', () => {
    renderDrawer({ canTransfer: true, annotations: [bookmark('a', 0.2)] })

    expect(screen.getByRole('button', { name: '导出注解' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '导入注解' })).toBeEnabled()
  })

  it('没有注解可导时按钮留着但禁用，让用户知道这个能力存在', () => {
    renderDrawer({ canTransfer: true, annotations: [] })

    expect(screen.getByRole('button', { name: '导出注解' })).toBeDisabled()
    // 导入是把别人的注解拿进来，空列表照样该能点
    expect(screen.getByRole('button', { name: '导入注解' })).toBeEnabled()
  })

  it('两个按钮各自回调，不互相牵连', () => {
    const { onExport, onImport } = renderDrawer({
      canTransfer: true,
      annotations: [bookmark('a', 0.2)]
    })

    fireEvent.click(screen.getByRole('button', { name: '导出注解' }))
    expect(onExport).toHaveBeenCalledTimes(1)
    expect(onImport).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '导入注解' }))
    expect(onImport).toHaveBeenCalledTimes(1)
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('有结果文案时显示在按钮下面', () => {
    renderDrawer({ canTransfer: true, transferResult: '已导出 3 条注解' })

    expect(screen.getByText('已导出 3 条注解')).toBeInTheDocument()
  })

  it('没有结果文案时不留下一个空段落', () => {
    const { container } = renderDrawer({ canTransfer: true })

    expect(container.querySelector('.reader__drawer-notice')).toBeNull()
  })
})
