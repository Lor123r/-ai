import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Dialog, IpcMain } from 'electron'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { UNREADABLE_EPUB_REASON, UNSUPPORTED_FORMAT_REASON } from '@core/services/importBooks'
import { LIBRARY_CHANNELS } from '@shared/ipc'
import { registerLibraryIpc } from '../../../src/main/ipc/libraryIpc'
import { FileBookStore } from '../../../src/main/import/fileBookStore'
import { buildEpubFile } from '../../support/epubFixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown

let workDir: string
let sourceDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ebook-ipc-test-'))
  sourceDir = join(workDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

interface SetupResult {
  invoke: () => Promise<unknown>
  repository: InMemoryBookRepository
  showOpenDialog: ReturnType<typeof vi.fn>
}

/** 用假的 ipcMain 与假的 dialog 抓取协议行为，不必真的启动 Electron。 */
function setup(filePaths: string[] = [], canceled = false): SetupResult {
  const repository = new InMemoryBookRepository()
  const handlers = new Map<string, Handler>()
  const showOpenDialog = vi.fn(async () => ({ canceled, filePaths }))

  registerLibraryIpc(
    {
      handle: (channel: string, listener: Handler) => {
        handlers.set(channel, listener)
      }
    } as unknown as IpcMain,
    {
      repository,
      fileStore: new FileBookStore({ userDataDir: workDir }),
      dialog: { showOpenDialog } as unknown as Dialog,
      getWindow: () => null
    }
  )

  return {
    repository,
    showOpenDialog,
    invoke: async () => {
      const handler = handlers.get(LIBRARY_CHANNELS.import)
      if (!handler) throw new Error('导入频道未注册')
      return await handler({})
    }
  }
}

describe('registerLibraryIpc', () => {
  it('导入成功后返回数量摘要，并把书写进仓库', async () => {
    const source = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })
    const { invoke, repository } = setup([source])

    await expect(invoke()).resolves.toEqual({ added: 1, skipped: 0, failed: [] })
    await expect(repository.list()).resolves.toMatchObject([{ title: '三体', author: '刘慈欣' }])
  })

  it('用户取消选择时返回 null，书库保持不变', async () => {
    const { invoke, repository } = setup([], true)

    await expect(invoke()).resolves.toBeNull()
    await expect(repository.list()).resolves.toEqual([])
  })

  it('选择框里没有文件时也返回 null', async () => {
    const { invoke } = setup([])

    await expect(invoke()).resolves.toBeNull()
  })

  it('重复导入只返回 skipped 计数', async () => {
    const source = await buildEpubFile(join(sourceDir, '三体.epub'))
    const { invoke } = setup([source])

    await invoke()
    await expect(invoke()).resolves.toEqual({ added: 0, skipped: 1, failed: [] })
  })

  it('损坏文件与不支持的格式都进 failed 摘要，不抛出异常', async () => {
    const broken = join(sourceDir, '坏书.epub')
    await writeFile(broken, 'not a zip')
    const { invoke } = setup([broken, join(sourceDir, '说明书.pdf')])

    const summary = (await invoke()) as { added: number; skipped: number; failed: unknown[] }

    expect(summary.added).toBe(0)
    expect(summary.skipped).toBe(0)
    // 预筛在读取之前统一跑完，所以「格式不支持」总是排在「解析失败」前面。
    expect(summary.failed).toEqual([
      { sourcePath: join(sourceDir, '说明书.pdf'), reason: UNSUPPORTED_FORMAT_REASON },
      { sourcePath: broken, reason: UNREADABLE_EPUB_REASON }
    ])
  })

  it('一个成功一个失败时摘要同时给出 added 与 failed', async () => {
    const good = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体' })
    const { invoke } = setup([good, join(sourceDir, '说明书.pdf')])

    const summary = (await invoke()) as { added: number; failed: unknown[] }

    expect(summary.added).toBe(1)
    expect(summary.failed).toHaveLength(1)
  })

  it('把电子书扩展名写进选择框过滤器', async () => {
    const { invoke, showOpenDialog } = setup([])

    await invoke()

    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    const options = showOpenDialog.mock.calls[0]?.[0] as { properties: string[]; filters: { extensions: string[] }[] }
    expect(options.properties).toEqual(['openFile', 'multiSelections'])
    expect(options.filters[0]?.extensions).toEqual(['epub', 'txt'])
  })
})
