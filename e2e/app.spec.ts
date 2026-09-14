import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
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
  api?: {
    books: {
      save(book: unknown): Promise<void>
      list(): Promise<{ id: string }[]>
      getLocator(bookId: string): Promise<{ percent: number } | null>
    }
  }
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

test('点开书架上的书会进入阅读器，翻页后能返回书架', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })

  try {
    const app = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await stubFilePicker(app, [epubPath])

      await page.getByRole('button', { name: '导入书籍' }).click()
      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()

      await page.getByRole('button', { name: '三体', exact: true }).click()

      // 书名既是书架上的按钮，也是阅读器标题栏里的 h1
      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader).toBeVisible()
      await expect(reader.getByRole('heading', { name: '三体' })).toBeVisible()

      // 真实 epub.js 会在 viewport 里插一个 iframe 承载章节正文
      await expect(reader.getByText('阅读中')).toBeVisible()
      await expect(reader.locator('.reader__viewport iframe')).toHaveCount(1)

      const next = reader.getByRole('button', { name: '下一页' })
      await expect(reader.getByRole('button', { name: '上一页' })).toBeEnabled()
      await next.click()
      await expect(reader.locator('.reader__error')).toHaveCount(0)
      await expect(reader.getByText('阅读中')).toBeVisible()

      await reader.getByRole('button', { name: '返回书架' }).click()
      await expect(reader).toHaveCount(0)
      await expect(page.getByRole('heading', { name: '书架' })).toBeVisible()
      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('阅读进度会落盘，重开应用后从上次的位置继续', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })

  try {
    const first = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    let savedPercent = ''
    try {
      const page = await first.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await stubFilePicker(first, [epubPath])

      await page.getByRole('button', { name: '导入书籍' }).click()
      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()

      await page.getByRole('button', { name: '三体', exact: true }).click()
      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader.getByText('阅读中')).toBeVisible()

      // 样例书每章只有一页，翻一页必定跨到后一章，进度只可能往前
      await reader.getByRole('button', { name: '下一页' }).click()
      const percent = reader.locator('.reader__percent')
      await expect(percent).not.toHaveText('0%')
      savedPercent = ((await percent.textContent()) ?? '').trim()
      expect(savedPercent).not.toBe('')

      await reader.getByRole('button', { name: '返回书架' }).click()
      await expect(page.getByRole('heading', { name: '书架' })).toBeVisible()

      // 等落盘真的完成再关应用，否则测到的是内存里的进度
      await expect
        .poll(async () =>
          page.evaluate(async () => {
            const api = (globalThis as unknown as BridgeWindow).api!
            const [book] = await api.books.list()
            const locator = book ? await api.books.getLocator(book.id) : null
            return locator?.percent ?? 0
          })
        )
        .toBeGreaterThan(0)
    } finally {
      await first.close()
    }

    const second = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()

      await page.getByRole('button', { name: '三体', exact: true }).click()
      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader.locator('.reader__percent')).toHaveText(savedPercent)
      await expect(reader.getByText('阅读中')).toBeVisible()
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

/**
 * 收集章节 iframe 里的正文。
 * epub.js 一章一个 iframe，转场期间新旧两章会同时存在，所以不能只认第一个。
 */
async function chapterText(page: Page): Promise<string> {
  const parts: string[] = []
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const text = await frame
      .locator('body')
      .innerText({ timeout: 1000 })
      .catch(() => '')
    if (text) parts.push(text)
  }
  return parts.join('\n')
}

/** 正文 iframe 的 body 内联字号，用来验证阅读设置真的作用到了书内样式上。 */
async function chapterFontSize(page: Page): Promise<string | null> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    const style = await frame
      .locator('body')
      .getAttribute('style', { timeout: 1000 })
      .catch(() => null)
    const match = /font-size:\s*([^;!]+)/.exec(style ?? '')
    if (match) return match[1]!.trim()
  }
  return null
}

test('目录会列出章节，点击条目后正文跳到对应章节', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), {
    title: '三体',
    author: '刘慈欣',
    spineItems: 3,
    navItems: [
      { label: '第一章 科学边界', href: 'chapter1.xhtml' },
      {
        label: '第二章 台球',
        href: 'chapter2.xhtml',
        subitems: [{ label: '第二章 第一节', href: 'chapter2.xhtml#sec1' }]
      },
      { label: '第三章 射手', href: 'chapter3.xhtml' }
    ]
  })

  try {
    const app = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await stubFilePicker(app, [epubPath])

      await page.getByRole('button', { name: '导入书籍' }).click()
      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()
      await page.getByRole('button', { name: '三体', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader.getByText('阅读中')).toBeVisible()
      await expect.poll(() => chapterText(page)).toContain('第 1 章正文')

      const tocButton = reader.getByRole('button', { name: '目录', exact: true })
      await expect(tocButton).toHaveAttribute('aria-expanded', 'false')
      await tocButton.click()

      const drawer = reader.getByRole('complementary', { name: '目录' })
      await expect(drawer).toBeVisible()
      await expect(drawer.getByRole('button', { name: '第一章 科学边界' })).toBeVisible()
      // 嵌套目录项也会列出来，靠缩进表达层级
      await expect(drawer.getByRole('button', { name: '第二章 第一节' })).toBeVisible()
      await expect(tocButton).toHaveAttribute('aria-expanded', 'true')

      // 先确认第 3 章此刻还没进正文，否则后面的断言证明不了「是点目录跳过去的」
      await expect.poll(() => chapterText(page)).not.toContain('第 3 章正文')

      await drawer.getByRole('button', { name: '第三章 射手' }).click()

      await expect(drawer).toHaveCount(0)
      await expect.poll(() => chapterText(page)).toContain('第 3 章正文')
      await expect.poll(() => chapterText(page)).not.toContain('第 1 章正文')
      await expect(reader.locator('.reader__error')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('阅读设置会落盘，重开应用后依然生效', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体' })
  const settingsPath = join(userDataDir, 'settings.json')

  try {
    const first = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await first.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await stubFilePicker(first, [epubPath])

      await page.getByRole('button', { name: '导入书籍' }).click()
      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()
      await page.getByRole('button', { name: '三体', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader).toHaveAttribute('data-theme', 'day')
      await expect.poll(() => chapterFontSize(page)).toBe('18px')

      await reader.getByRole('button', { name: '设置', exact: true }).click()
      const panel = reader.getByRole('complementary', { name: '阅读设置' })
      await expect(panel).toBeVisible()

      const fontSize = panel.locator('.setting-row').filter({ hasText: '字号' }).locator('.setting-row__value')
      await expect(fontSize).toHaveText('18 px')

      await panel.getByRole('button', { name: '增大字号' }).click()
      await expect(fontSize).toHaveText('19 px')
      await panel.getByRole('button', { name: '增大字号' }).click()
      await expect(fontSize).toHaveText('20 px')

      await panel.getByRole('button', { name: '夜间' }).click()
      await expect(reader).toHaveAttribute('data-theme', 'night')
      await expect(panel.getByRole('button', { name: '夜间' })).toHaveAttribute('aria-pressed', 'true')

      // 设置必须真的作用到书内样式，而不是只改了面板上的数字
      await expect.poll(() => chapterFontSize(page)).toBe('20px')

      // 落盘是节流的，必须等它写完再关应用，否则重启读到的是旧值
      await expect
        .poll(async () => {
          const snapshot = JSON.parse(await readFile(settingsPath, 'utf8')) as {
            settings: { fontSize: number; theme: string }
          }
          return `${snapshot.settings.fontSize}/${snapshot.settings.theme}`
        })
        .toBe('20/night')
    } finally {
      await first.close()
    }

    const second = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.getByRole('button', { name: '三体', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader).toHaveAttribute('data-theme', 'night')
      await expect.poll(() => chapterFontSize(page)).toBe('20px')

      await reader.getByRole('button', { name: '设置', exact: true }).click()
      const panel = reader.getByRole('complementary', { name: '阅读设置' })
      await expect(
        panel.locator('.setting-row').filter({ hasText: '字号' }).locator('.setting-row__value')
      ).toHaveText('20 px')
    } finally {
      await second.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})
