import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ReaderChrome, { type ReaderChromeProps } from '@renderer/reader/ReaderChrome'

afterEach(() => {
  cleanup()
})

function renderChrome(overrides: Partial<ReaderChromeProps> = {}): {
  onClose: ReturnType<typeof vi.fn>
  onPanelChange: ReturnType<typeof vi.fn>
  onMove: ReturnType<typeof vi.fn>
} {
  const onClose = vi.fn()
  const onPanelChange = vi.fn()
  const onMove = vi.fn()

  render(
    <ReaderChrome
      title="三体"
      theme="day"
      status="ready"
      percent={null}
      panel="none"
      onPanelChange={onPanelChange}
      onClose={onClose}
      onMove={onMove}
      {...overrides}
    >
      <p>正文</p>
    </ReaderChrome>
  )

  return { onClose, onPanelChange, onMove }
}

describe('ReaderChrome', () => {
  it('把标题放进可访问名与 h1，并按主题标记外壳', () => {
    renderChrome({ theme: 'night' })

    const shell = screen.getByLabelText('正在阅读《三体》')

    expect(shell).toHaveAttribute('data-theme', 'night')
    expect(screen.getByRole('heading', { name: '三体' })).toBeInTheDocument()
  })

  it('状态文案跟着 status 走', () => {
    renderChrome({ status: 'loading' })
    expect(screen.getByText('正在打开…')).toBeInTheDocument()

    cleanup()
    renderChrome({ status: 'error' })
    expect(screen.getByText('打开失败')).toBeInTheDocument()
  })

  it('没有进度就不渲染百分比', () => {
    renderChrome({ percent: null })

    expect(screen.queryByLabelText('阅读进度')).not.toBeInTheDocument()
  })

  it('有进度时按百分号显示', () => {
    renderChrome({ percent: 0.42 })

    expect(screen.getByLabelText('阅读进度')).toHaveTextContent('42%')
  })

  it('加载中与打开失败时目录、设置、翻页按钮都不可用', () => {
    renderChrome({ status: 'loading' })

    expect(screen.getByRole('button', { name: '目录' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '设置' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    // 注解是本地数据，不依赖正文，所以始终可点
    expect(screen.getByRole('button', { name: '注解' })).toBeEnabled()
  })

  it('tocDisabled 让目录置灰而不是消失', () => {
    renderChrome({ tocDisabled: true })

    expect(screen.getByRole('button', { name: '目录' })).toBeDisabled()
  })

  it('点目录按钮在「展开」与「收起」之间切换', () => {
    const { onPanelChange } = renderChrome({ panel: 'none' })

    fireEvent.click(screen.getByRole('button', { name: '目录' }))
    expect(onPanelChange).toHaveBeenCalledWith('toc')
  })

  it('同一个面板再点一次就是收起', () => {
    const { onPanelChange } = renderChrome({ panel: 'toc' })

    fireEvent.click(screen.getByRole('button', { name: '目录' }))
    expect(onPanelChange).toHaveBeenCalledWith('none')
  })

  it('换到另一个面板时不会先把当前面板关掉', () => {
    const { onPanelChange } = renderChrome({ panel: 'toc' })

    fireEvent.click(screen.getByRole('button', { name: '设置' }))
    expect(onPanelChange).toHaveBeenCalledTimes(1)
    expect(onPanelChange).toHaveBeenCalledWith('settings')
  })

  it('aria-expanded 反映当前面板', () => {
    renderChrome({ panel: 'annotations' })

    expect(screen.getByRole('button', { name: '注解' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: '目录' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('翻页按钮把方向报出去', () => {
    const { onMove } = renderChrome()

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))

    expect(onMove).toHaveBeenNthCalledWith(1, 'next')
    expect(onMove).toHaveBeenNthCalledWith(2, 'prev')
  })

  it('返回书架直接透传', () => {
    const { onClose } = renderChrome()

    fireEvent.click(screen.getByRole('button', { name: '返回书架' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('错误行默认不渲染，有值才出现', () => {
    renderChrome()
    expect(screen.queryByText(/无法打开本书/)).not.toBeInTheDocument()

    cleanup()
    renderChrome({ loadError: '书籍文件不存在' })
    expect(screen.getByText('无法打开本书：书籍文件不存在')).toBeInTheDocument()
  })

  it('注解错误是独立的一行', () => {
    renderChrome({ annotationError: '读不到注解存档' })

    expect(screen.getByText('读不到注解存档')).toBeInTheDocument()
    expect(screen.queryByText(/无法打开本书/)).not.toBeInTheDocument()
  })

  it('正文与额外按钮都渲染在外壳里', () => {
    renderChrome({ extraActions: <button type="button">加书签</button> })

    expect(screen.getByText('正文')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加书签' })).toBeInTheDocument()
  })

  it('bodyRef 交给正文容器的 DOM 节点', () => {
    let captured: HTMLDivElement | null = null
    renderChrome({
      bodyRef: (element) => {
        captured = element
      }
    })

    expect(captured).not.toBeNull()
    expect((captured as unknown as HTMLElement).className).toBe('reader__body')
  })
})
