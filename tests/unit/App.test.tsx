import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '@renderer/App'
import { installFakeBridge } from './support/fakeBridge'

afterEach(() => {
  cleanup()
  delete window.api
})

describe('App', () => {
  it('渲染书架标题与空态提示', async () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: '书架' })).toBeInTheDocument()
    expect(screen.getByText('正在读取书架…')).toBeInTheDocument()
    expect(await screen.findByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toBeInTheDocument()
  })

  it('没有 preload 注入时降级为浏览器预览模式', async () => {
    render(<App />)

    expect(await screen.findByText('浏览器预览模式')).toBeInTheDocument()
  })

  it('有 preload 注入时展示应用版本与 Electron 版本', async () => {
    const cleanup = installFakeBridge({
      app: '0.1.0',
      node: '24.21.0',
      chrome: '140.0.7339.0',
      electron: '38.2.0'
    })

    try {
      render(<App />)

      expect(await screen.findByText('v0.1.0 · Electron 38.2.0')).toBeInTheDocument()
    } finally {
      cleanup()
    }
  })
})
