import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { buildEpubFile } from '../tests/support/epubFixture'

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/** Electron 的 env 只接受字符串值，process.env 里可能混着 undefined。 */
function launchEnv(userDataDir: string): Record<string, string> {
  const inherited: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') inherited[key] = value
  }
  return { ...inherited, EBOOK_READER_USER_DATA: userDataDir }
}

interface BridgeWindow {
  api?: { books: { save(book: unknown): Promise<void> } }
}

/** 原生文件选择框无法自动化，改成在主进程里替换掉 showOpenDialog 的返回值。 */
async function stubFilePicker(app: Awaited<ReturnType<typeof electron.launch>>, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  }, filePaths)
}

async function seedBook(page: Page, id: string, title: string): Promise<void> {
  await page.evaluate(
    ({ bookId, bookTitle }) =>
      (globalThis as unknown as BridgeWindow).api!.books.save({
        id: bookId,
        title: bookTitle,
        author: '端到端测试',
        format: 'epub',
        filePath: `C:/library/${bookId}.epub`,
        fileSize: 2048,
        coverPath: null,
        addedAt: 1_700_000_000_000,
        lastOpenedAt: null
      }),
    { bookId: id, bookTitle: title }
  )
}

test('应用启动后展示书架空态', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))

  try {
    const app = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })

    try {
      const window = await app.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      await expect(window.getByRole('heading', { name: '书架' })).toBeVisible()
      await expect(window.getByText('书架还是空的，导入 EPUB 后就会出现在这里。')).toBeVisible()
      await expect(window.getByText(/^Electron \d+\.\d+\.\d+ · Chromium /)).toBeVisible()

      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('通过 IPC 保存的书籍会落盘，并在重启后重新出现在书架上', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))

  try {
    const first = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await first.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByText('书架还是空的，导入 EPUB 后就会出现在这里。')).toBeVisible()

      await seedBook(page, 'book-1', '持久化样书')
      await page.reload()

      await expect(page.getByRole('heading', { name: '持久化样书' })).toBeVisible()
      await expect(page.getByText('端到端测试')).toBeVisible()
    } finally {
      await first.close()
    }

    const second = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      await expect(page.getByRole('heading', { name: '持久化样书' })).toBeVisible()
      await expect(page.getByText('书架还是空的，导入 EPUB 后就会出现在这里。')).toHaveCount(0)
    } finally {
      await second.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('导入 EPUB 后书籍进入书架并落盘，重启后依然在书架上', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })

  try {
    const first = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await first.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      await stubFilePicker(first, [epubPath])
      await page.getByRole('button', { name: '导入书籍' }).click()

      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()
      await expect(page.getByText('刘慈欣')).toBeVisible()
      await expect(page.getByRole('status')).toHaveText('已导入 1 本')
      await expect(page.getByText('1 本', { exact: true })).toBeVisible()
      // 封面由主进程读出后转成 data URL 交给渲染进程，绕开 file:// 的跨源限制
      await expect(page.getByRole('img', { name: '《三体》封面' })).toHaveAttribute(
        'src',
        /^data:image\/png;base64,/
      )

      expect(await readdir(join(userDataDir, 'books'))).toHaveLength(1)
    } finally {
      await first.close()
    }

    const second = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()
      // 提示是本次会话的临时状态，重启后不该再出现
      await expect(page.getByRole('status')).toHaveCount(0)
    } finally {
      await second.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('重复导入同一本书会被跳过而不是复制第二份', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体' })

  try {
    const app = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await stubFilePicker(app, [epubPath])

      await page.getByRole('button', { name: '导入书籍' }).click()
      await expect(page.getByRole('status')).toHaveText('已导入 1 本')

      await page.getByRole('button', { name: '导入书籍' }).click()
      await expect(page.getByRole('status')).toHaveText('跳过 1 本重复书籍')

      expect(await readdir(join(userDataDir, 'books'))).toHaveLength(1)
      await expect(page.getByRole('heading', { name: '三体' })).toHaveCount(1)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})
