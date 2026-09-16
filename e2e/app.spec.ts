import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
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
      list(): Promise<{ id: string; coverPath: string | null }[]>
      getLocator(bookId: string): Promise<{ percent: number } | null>
    }
    annotations: {
      listByBook(bookId: string): Promise<unknown[]>
      save(annotation: unknown): Promise<void>
      remove(bookId: string, annotationId: string): Promise<void>
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

/** 一条字段齐全的书签，用于验证注解走完整条 IPC 链路。 */
function sampleAnnotation(bookId: string) {
  return {
    id: 'a1',
    bookId,
    kind: 'bookmark',
    cfi: 'epubcfi(/6/4!/4/2)',
    chapterHref: 'ch1.xhtml',
    percent: 0.25,
    note: '端到端笔记',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000
  }
}

async function saveAnnotation(page: Page, bookId: string): Promise<void> {
  await page.evaluate(
    (annotation) => (globalThis as unknown as BridgeWindow).api!.annotations.save(annotation),
    sampleAnnotation(bookId)
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

test('通过 IPC 保存的注解会落盘，重启后仍然读得到', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const annotationsPath = join(userDataDir, 'annotations.json')

  try {
    const first = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await first.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      await saveAnnotation(page, 'book-1')

      // 渲染层递来的数据在信任边界之外：非法 id 必须被主进程挡下，不许写进存档
      const rejected = await page.evaluate(async () => {
        try {
          await (globalThis as unknown as BridgeWindow).api!.annotations.save({
            id: 'a 1',
            bookId: 'book-1',
            kind: 'bookmark',
            cfi: 'epubcfi(/6/4!/4/2)'
          })
          return false
        } catch {
          return true
        }
      })
      expect(rejected).toBe(true)

      // 删一个不存在的 id 是幂等的，不该 reject
      await page.evaluate(() =>
        (globalThis as unknown as BridgeWindow).api!.annotations.remove('book-1', 'ghost')
      )

      const text = await readFile(annotationsPath, 'utf8')
      expect(text).toContain('a1')
      expect(text).not.toContain('a 1')
      expect(JSON.parse(text)).toMatchObject({ version: 1 })
    } finally {
      await first.close()
    }

    const second = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const annotations = await page.evaluate((bookId) =>
        (globalThis as unknown as BridgeWindow).api!.annotations.listByBook(bookId)
      , 'book-1')
      expect(annotations).toEqual([sampleAnnotation('book-1')])
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

/** 只在渲染进程里成立的全局；主进程工程没有 DOM lib，所以在这里自己声明。 */
interface RendererCryptoScope {
  isSecureContext?: boolean
  crypto?: {
    randomUUID?: () => string
    getRandomValues?: (array: Uint8Array) => Uint8Array
  }
}

test('渲染进程的 WebCrypto 满足注解 id 生成的降级假设', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))

  try {
    const app = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })

    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const probe = await page.evaluate(() => {
        const scope = globalThis as unknown as RendererCryptoScope
        const webCrypto = scope.crypto
        const randomUUID = webCrypto === undefined ? undefined : webCrypto.randomUUID
        const hasRandomUUID = typeof randomUUID === 'function'
        const ids: string[] = []
        if (webCrypto !== undefined && hasRandomUUID) {
          for (let index = 0; index < 200; index += 1) ids.push(webCrypto.randomUUID!())
        }
        return {
          isSecureContext: scope.isSecureContext === true,
          hasRandomUUID,
          hasGetRandomValues: webCrypto !== undefined && typeof webCrypto.getRandomValues === 'function',
          ids
        }
      })

      // 生产环境用 file:// 加载页面，Chromium 把 file:// 视作可信来源，所以这里是安全上下文，
      // randomUUID 这一档就是真实生产路径。若哪天它变成 false，说明第一档已经失效。
      expect(probe.isSecureContext).toBe(true)
      expect(probe.hasRandomUUID).toBe(true)
      // getRandomValues 不受安全上下文限制，所以 randomUUID 万一被挡住，第二档仍然接得上。
      expect(probe.hasGetRandomValues).toBe(true)

      // 渲染层产出的 id 必须落进主进程的白名单：长度 ≤ 128、字符集 [A-Za-z0-9_-]。
      expect(probe.ids).toHaveLength(200)
      for (const id of probe.ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
      expect(new Set(probe.ids).size).toBe(200)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

/** 只在正文 iframe 里成立的对象；主进程工程没有 DOM lib，所以在这里自己声明。 */
interface FrameSelectionScope {
  document: {
    body: { querySelector(selector: string): { firstChild: FrameTextNode | null } | null }
    createRange(): FrameRange
    getSelection(): FrameSelection | null
  }
}

interface FrameTextNode {
  length: number
}

interface FrameRange {
  setStart(node: FrameTextNode, offset: number): void
  setEnd(node: FrameTextNode, offset: number): void
}

interface FrameSelection {
  removeAllRanges(): void
  addRange(range: FrameRange): void
}

/**
 * 在正文 iframe 里手工造一个覆盖整段正文的选区。
 *
 * 三个坑：epub.js 的 selected 事件监听的是 iframe 文档上的 selectionchange，
 * 内部还有 250ms 防抖，所以造完选区不能立刻断言；转场期间新旧章节会同时存在，
 * 只能挑第一个真的造出选区的 frame。返回 false 表示没有可选的正文。
 */
async function selectChapterText(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue

    const selected = await frame
      .evaluate(() => {
        const scope = globalThis as unknown as FrameSelectionScope
        const text = scope.document.body.querySelector('p')?.firstChild
        if (!text) return false

        const selection = scope.document.getSelection()
        if (!selection) return false

        const range = scope.document.createRange()
        range.setStart(text, 0)
        range.setEnd(text, text.length)
        selection.removeAllRanges()
        selection.addRange(range)
        return true
      })
      .catch(() => false)

    if (selected) return true
  }

  return false
}

/**
 * 正文里的划线标记数量。epub.js 会给每条划线对应的 SVG 分组盖上 ref 属性，
 * 类名没显式传时就是它自带的 epubjs-hl。图层挂在宿主文档的阅读区里，不在 iframe 内。
 */
async function highlightMarkCount(page: Page): Promise<number> {
  return page.locator('.reader__viewport [ref^="epubjs-hl"]').count()
}

/** 数一数注解存档里有多少条；文件还没写出来时返回 -1，交给 expect.poll 继续等。 */
async function savedAnnotationCount(annotationsPath: string): Promise<number> {
  try {
    const snapshot = JSON.parse(await readFile(annotationsPath, 'utf8')) as { annotations: unknown[] }
    return snapshot.annotations.length
  } catch {
    return -1
  }
}

/** 存档文件里是否还留着某本书的痕迹；文件不存在按「没有」处理。 */
async function annotationsMention(annotationsPath: string, bookId: string): Promise<boolean> {
  try {
    return (await readFile(annotationsPath, 'utf8')).includes(bookId)
  } catch {
    return false
  }
}

/** 列目录下的文件名；目录不在时按空目录处理，让断言失败在「文件还在不在」上。 */
async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

test('在正文里划线会落盘，重启后重新画回正文', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })
  const annotationsPath = join(userDataDir, 'annotations.json')

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
      await expect(reader.getByText('阅读中')).toBeVisible()
      await expect.poll(() => chapterText(page)).toContain('第 1 章正文')
      expect(await highlightMarkCount(page)).toBe(0)

      // 造出选区后 epub.js 要等防抖过去才会报选中，浮条的出现本身就是这条链路的断言
      expect(await selectChapterText(page)).toBe(true)
      const toolbar = reader.getByRole('toolbar', { name: '选中文字的操作' })
      await expect(toolbar).toBeVisible()
      await toolbar.getByRole('button', { name: '划线', exact: true }).click()

      // 划线先落到本地列表再落到存档上，两处都要能看到才算真的画下去了
      await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(0)
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)

      const snapshot = JSON.parse(await readFile(annotationsPath, 'utf8')) as {
        annotations: { kind: string; cfi: string; excerpt: string }[]
      }
      const saved = snapshot.annotations[0]
      expect(saved?.kind).toBe('highlight')
      // 摘录与 cfi 都得来自真实的 iframe 选区，不是界面上拼出来的占位
      expect(saved?.excerpt).toBe('第 1 章正文')
      expect(saved?.cfi).toMatch(/^epubcfi\(/)

      await reader.getByRole('button', { name: '注解', exact: true }).click()
      const drawer = reader.getByRole('complementary', { name: '注解' })
      await expect(drawer.locator('.annotation-list__kind')).toHaveText('划线')
      await expect(drawer.getByRole('button', { name: '删除 第 1 章正文' })).toBeVisible()
      await expect(reader.locator('.reader__annotation-error')).toHaveCount(0)
    } finally {
      await first.close()
    }

    const second = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.getByRole('button', { name: '三体', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader.getByText('阅读中')).toBeVisible()

      // 存档里的划线要在新 rendition 上重新注入，而不是只躺在列表里
      await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(0)

      await reader.getByRole('button', { name: '注解', exact: true }).click()
      const drawer = reader.getByRole('complementary', { name: '注解' })
      await expect(drawer.getByRole('button', { name: '删除 第 1 章正文' })).toBeVisible()
      await expect(reader.locator('.reader__annotation-error')).toHaveCount(0)
    } finally {
      await second.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('删掉已有的划线后，重启也不会再画回来', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })
  const annotationsPath = join(userDataDir, 'annotations.json')
  let removedId = ''

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
      await expect(reader.getByText('阅读中')).toBeVisible()
      await expect.poll(() => chapterText(page)).toContain('第 1 章正文')

      expect(await selectChapterText(page)).toBe(true)
      const toolbar = reader.getByRole('toolbar', { name: '选中文字的操作' })
      await expect(toolbar).toBeVisible()
      await toolbar.getByRole('button', { name: '划线', exact: true }).click()
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)

      const seeded = JSON.parse(await readFile(annotationsPath, 'utf8')) as {
        annotations: { id: string }[]
      }
      removedId = seeded.annotations[0]?.id ?? ''
      expect(removedId).not.toBe('')

      await reader.getByRole('button', { name: '注解', exact: true }).click()
      const drawer = reader.getByRole('complementary', { name: '注解' })
      const remove = drawer.getByRole('button', { name: '删除 第 1 章正文' })
      await expect(remove).toBeVisible()
      await remove.click()

      // 列表、正文标记、存档三处都要跟着消失，只抹掉界面上的那一行不算删干净
      await expect(drawer.getByText('还没有书签或划线')).toBeVisible()
      await expect.poll(() => highlightMarkCount(page)).toBe(0)
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(0)
      expect(await readFile(annotationsPath, 'utf8')).not.toContain(removedId)
    } finally {
      await first.close()
    }

    const second = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.getByRole('button', { name: '三体', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader.getByText('阅读中')).toBeVisible()
      await expect.poll(() => chapterText(page)).toContain('第 1 章正文')

      await reader.getByRole('button', { name: '注解', exact: true }).click()
      const drawer = reader.getByRole('complementary', { name: '注解' })
      await expect(drawer.getByText('还没有书签或划线')).toBeVisible()
      expect(await highlightMarkCount(page)).toBe(0)
      await expect(reader.locator('.reader__annotation-error')).toHaveCount(0)
    } finally {
      await second.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('删书会清掉这本书的注解与磁盘文件，再导入同一个文件不会复活', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })
  const annotationsPath = join(userDataDir, 'annotations.json')
  let bookId = ''

  try {
    const app = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await stubFilePicker(app, [epubPath])

      await page.getByRole('button', { name: '导入书籍' }).click()
      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()

      // 书籍 id 是文件内容的 sha256，先从桥里取回来，后面两处断言都要用它
      const shelf = await page.evaluate(() => (globalThis as unknown as BridgeWindow).api!.books.list())
      bookId = shelf[0]?.id ?? ''
      expect(bookId).not.toBe('')

      const coverPath = shelf[0]?.coverPath ?? null
      if (coverPath === null) throw new Error('这条用例依赖 fixture 默认带封面')
      const coverFileName = basename(coverPath)
      const booksDir = join(userDataDir, 'books')
      const coversDir = join(userDataDir, 'covers')

      // 先确认这两个文件真的落过盘，否则后面「删掉了」可能只是从来没写出来过
      expect(await listDir(booksDir)).toContain(`${bookId}.epub`)
      expect(await listDir(coversDir)).toContain(coverFileName)

      await saveAnnotation(page, bookId)
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)

      await page.getByRole('button', { name: '删除《三体》' }).click()
      await expect(page.getByText('书架还是空的，导入 EPUB 后就会出现在这里。')).toBeVisible()

      // 界面上少一张卡不算数：存档里的条目与这本书的 key 都要真的消失
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(0)
      await expect.poll(() => annotationsMention(annotationsPath, bookId)).toBe(false)
      expect(
        await page.evaluate(
          (id) => (globalThis as unknown as BridgeWindow).api!.annotations.listByBook(id),
          bookId
        )
      ).toEqual([])

      // 磁盘上的文件同样要回收。bookId 就是文件内容的 sha256，残留的 epub 与封面
      // 不会再被任何界面引用到，只会白占空间
      await expect.poll(() => listDir(booksDir)).not.toContain(`${bookId}.epub`)
      await expect.poll(() => listDir(coversDir)).not.toContain(coverFileName)

      // 同一个文件再导入一次，bookId 会一模一样，注解没有复活才算这条链真的通到了底
      await stubFilePicker(app, [epubPath])
      await page.getByRole('button', { name: '导入书籍' }).click()
      await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()
      // 回收文件不能把重新导入的路堵死：同一个 sha256 要能重新落盘
      expect(await listDir(booksDir)).toContain(`${bookId}.epub`)
      await page.getByRole('button', { name: '三体', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader.getByText('阅读中')).toBeVisible()
      await reader.getByRole('button', { name: '注解', exact: true }).click()

      const drawer = reader.getByRole('complementary', { name: '注解' })
      await expect(drawer.getByText('还没有书签或划线')).toBeVisible()
      await expect(reader.locator('.reader__annotation-error')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})
