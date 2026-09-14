import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '@renderer/App'

afterEach(() => {
  cleanup()
  delete window.api
})

describe('App', () => {
  it('渲染书架标题与空态提示', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '书架' })).toBeInTheDocument()
    expect(screen.getByText('书架还是空的，导入 EPUB 后就会出现在这里。')).toBeInTheDocument()
  })

  it('没有 preload 注入时降级为浏览器预览模式', () => {
    render(<App />)

    expect(screen.getByText('浏览器预览模式')).toBeInTheDocument()
  })

  it('有 preload 注入时展示 Electron 运行时版本', () => {
    window.api = {
      versions: { node: '24.21.0', chrome: '140.0.7339.0', electron: '38.2.0' }
    }

    render(<App />)

    expect(screen.getByText('Electron 38.2.0 · Chromium 140.0.7339.0')).toBeInTheDocument()
  })
})
