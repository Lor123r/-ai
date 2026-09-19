import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import type { UpdateCheckResult } from '@core/domain/update'
import { BookRepositoryProvider } from '@renderer/data/BookRepositoryProvider'
import { CoverReaderProvider } from '@renderer/data/CoverReaderProvider'
import Bookshelf from '@renderer/shelf/Bookshelf'
import { createFakeBridge, createFakeUpdateBridge } from '../support/fakeBridge'

afterEach(() => {
  cleanup()
  delete window.api
})

function installBridge(check: () => Promise<UpdateCheckResult>): void {
  window.api = { ...createFakeBridge(), update: createFakeUpdateBridge(check) }
}

function renderShelf(): void {
  render(
    <BookRepositoryProvider repository={new InMemoryBookRepository()}>
      <CoverReaderProvider reader={null}>
        <Bookshelf />
      </CoverReaderProvider>
    </BookRepositoryProvider>
  )
}

describe('书架的更新提示', () => {
  it('有新版本时显示提示', async () => {
    installBridge(async () => ({
      status: 'available',
      latestVersion: '0.2.0',
      currentVersion: '0.1.0'
    }))

    renderShelf()

    expect(await screen.findByText('有新版本 v0.2.0（当前 v0.1.0）')).toBeInTheDocument()
  })

  it('已是最新时不显示任何提示', async () => {
    installBridge(async () => ({ status: 'up-to-date', currentVersion: '0.1.0' }))

    renderShelf()

    // 等书架本身渲染完，确认这段时间里没有冒出提示
    await screen.findByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')
    expect(screen.queryByText(/有新版本/)).not.toBeInTheDocument()
  })

  it('检查失败时不显示任何提示', async () => {
    // 网络不通不该在书架上留一条红字
    installBridge(async () => ({ status: 'unavailable', reason: 'network' }))

    renderShelf()

    await screen.findByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')
    expect(screen.queryByText(/有新版本/)).not.toBeInTheDocument()
  })

  it('IPC 抛错时不显示任何提示，也不炸掉书架', async () => {
    installBridge(async () => {
      throw new Error('IPC 挂了')
    })

    renderShelf()

    expect(await screen.findByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toBeInTheDocument()
    expect(screen.queryByText(/有新版本/)).not.toBeInTheDocument()
  })

  it('没有 window.api 时不发请求也不显示提示', async () => {
    // 浏览器预览模式：window.api 不存在
    renderShelf()

    expect(await screen.findByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toBeInTheDocument()
    expect(screen.queryByText(/有新版本/)).not.toBeInTheDocument()
  })

  it('只检查一次', async () => {
    const check = vi.fn(async (): Promise<UpdateCheckResult> => ({
      status: 'up-to-date',
      currentVersion: '0.1.0'
    }))
    installBridge(check)

    renderShelf()

    await waitFor(() => expect(check).toHaveBeenCalled())
    expect(check).toHaveBeenCalledTimes(1)
  })
})
