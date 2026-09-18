import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { buildEpubFile } from '../tests/support/epubFixture'
import { highlightFill } from '../src/renderer/src/reader/highlightPalette'

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
      getLocator(bookId: string): Promise<{
        percent: number
        cfi: string | null
        chapterIndex: number | null
      } | null>
    }
    annotations: {
      listByBook(bookId: string): Promise<unknown[]>
      save(annotation: unknown): Promise<void>
      remove(bookId: string, annotationId: string): Promise<void>
    }
    annotationTransfer: {
      exportBook(bookId: string): Promise<{ count: number } | null>
      importInto(bookId: string): Promise<unknown | null>
    }
  }
}

/** 原生文件选择框无法自动化，改成在主进程里替换掉 showOpenDialog 的返回值。 */
async function stubFilePicker(app: Awaited<ReturnType<typeof electron.launch>>, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  }, filePaths)
}

/**
 * 另存框也一样没法自动化。这里把落点换到测试目录，但**沿用应用建议的文件名** ——
 * 那名字本身就是要验证的行为（书名得先过一遍清洗），测试自己起名就把这一步绕过去了。
 */
async function stubSaveDialog(app: Awaited<ReturnType<typeof electron.launch>>, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, targetDir) => {
    dialog.showSaveDialog = (async (_window: unknown, options: { defaultPath?: string }) => {
      const suggested = options?.defaultPath ?? 'unsaved.json'
      return {
        canceled: false,
        filePath: `${targetDir}\\${suggested.split(/[\\/]/).pop() ?? 'unsaved.json'}`
      }
    }) as unknown as typeof dialog.showSaveDialog
  }, dir)
}

/**
 * 在元素的几何中心发一次真实坐标点击，绕开 Playwright 的可点性检查。
 *
 * 书卡的开书热区靠 `::after` 覆盖层撑满整张卡片，所以 `.book-card__cover` 的中心点
 * 会被那个覆盖层接走。Playwright 见目标元素「被别的元素拦截」会拒绝点击 —— 可那
 * 正是设计意图（点到封面就等于点到书）。要验这种热区，只能按坐标点。
 */
async function clickElementCenter(locator: Locator): Promise<void> {
  const point = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  await locator.page().mouse.click(point.x, point.y)
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

/**
 * 读百分比标签的**终值**。
 *
 * 百分比由 `useEffect` 回写，点完按钮立刻读 `textContent` 会拿到上一页的旧值，
 * 于是「翻页后百分比要变」这类断言会随渲染时机偶发失败。这里在页面内轮询到
 * 连续两次读数相同为止 —— 百分比只随翻页单调变化，读到的就是排完版的终值。
 */
async function settledPercent(percent: Locator): Promise<string> {
  return percent.evaluate(async (element) => {
    const read = (): string => (element.textContent ?? '').trim()
    let current = read()
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      const next = read()
      if (next === current) return next
      current = next
    }
    return current
  })
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
      await expect(window.getByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toBeVisible()
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
      await expect(page.getByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toBeVisible()

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
      await expect(page.getByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toHaveCount(0)
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
      // 提示条与书架在 .app-body 里各占一行；横排时提示条会被挤成窄竖条（实测 180px 宽、609px 高）。
      const noticeWidth = await page
        .getByRole('status')
        .evaluate((el) => el.getBoundingClientRect().width)
      const shelfWidth = await page.locator('.shelf').evaluate((el) => el.getBoundingClientRect().width)
      expect(noticeWidth).toBeGreaterThan(shelfWidth * 0.9)
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

      // 用户伸手去点的是「那本书」，所以热区得铺满整张卡片。
      // 封面是卡片上面积最大的一块，曾经谁都不响应 —— 点上去像应用没反应。
      await clickElementCenter(page.locator('.book-card__cover'))

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

      // 热区铺满之后，书名按钮自己也得还能点
      await page.getByRole('button', { name: '三体', exact: true }).click()
      await expect(reader).toBeVisible()
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

/**
 * TXT 与 EPUB 共用书架与进度模型，但正文通道完全独立：没有 cfi、没有 epub.js，
 * 分页是自己量 CSS 多栏算出来的。这一条从导入一路盖到重启续读。
 */
test('TXT 书能打开、翻页、落盘进度，重启后从同一页继续', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const txtPath = join(sourceDir, '山海经.txt')
  // 六段、每段八千余字：块数够多，段内也能撑出十来栏，翻几页都还在同一块里
  const paragraphs = Array.from(
    { length: 6 },
    (_unused, index) => `第 ${index + 1} 段\n${'山水草木鸟兽鱼虫'.repeat(1100)}`
  )
  await writeFile(txtPath, paragraphs.join('\n\n'), 'utf8')

  try {
    const first = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    let fourthPage = ''
    let fifthPage = ''
    try {
      const page = await first.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await stubFilePicker(first, [txtPath])
      await page.getByRole('button', { name: '导入书籍' }).click()

      await expect(page.getByRole('heading', { name: '山海经' })).toBeVisible()
      await expect(page.getByRole('status')).toHaveText('已导入 1 本')

      await page.getByRole('button', { name: '山海经', exact: true }).click()
      const reader = page.getByRole('region', { name: '正在阅读《山海经》' })
      await expect(reader).toBeVisible()
      await expect(reader.getByText('阅读中')).toBeVisible()

      // 确实走的是 TXT 通道：多栏容器在，epub.js 的 iframe 不该出现
      await expect(reader.locator('.reader__viewport--text')).toHaveCount(1)
      await expect(reader.locator('.txt-reader__block')).toContainText('山水草木鸟兽鱼虫')
      await expect(reader.locator('.reader__viewport iframe')).toHaveCount(0)

      // TXT 没有导航文档，目录是从正文里的标题行现算的。这一本只有「第 N 段」，
      // 认不出标题就退化成按块首列 —— 六个块就是六个条目
      const tocButton = reader.getByRole('button', { name: '目录', exact: true })
      await expect(tocButton).toBeEnabled()
      await tocButton.click()
      const drawer = reader.getByRole('complementary', { name: '目录' })
      await expect(drawer.locator('.toc-list__item')).toHaveCount(6)
      await drawer.getByRole('button', { name: '关闭目录' }).click()
      await expect(drawer).toHaveCount(0)

      await expect(reader.getByRole('button', { name: '加书签' })).toHaveCount(0)

      await reader.getByRole('button', { name: '注解', exact: true }).click()
      await expect(page.getByText('TXT 书暂不支持注解')).toBeVisible()
      await expect(page.locator('.annotation-list')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '导出注解' })).toHaveCount(0)
      await reader.getByRole('button', { name: '关闭注解' }).click()

      const percent = reader.locator('.reader__percent')
      await expect(percent).toHaveText('0%')

      const next = reader.getByRole('button', { name: '下一页' })
      for (let index = 0; index < 3; index += 1) await next.click()
      fourthPage = await settledPercent(percent)
      expect(fourthPage).not.toBe('0%')

      await next.click()
      fifthPage = await settledPercent(percent)
      expect(fifthPage).not.toBe(fourthPage)

      // 往回翻一页要能精确落回上一页，而不是退回块首
      await reader.getByRole('button', { name: '上一页' }).click()
      await expect(percent).toHaveText(fourthPage)

      await reader.getByRole('button', { name: '返回书架' }).click()
      await expect(page.getByRole('heading', { name: '书架' })).toBeVisible()

      let persisted: { percent: number; cfi: string | null; chapterIndex: number | null } | null = null
      await expect
        .poll(async () => {
          persisted = await page.evaluate(async () => {
            const api = (globalThis as unknown as BridgeWindow).api!
            const [book] = await api.books.list()
            return book ? await api.books.getLocator(book.id) : null
          })
          return persisted?.percent ?? 0
        })
        .toBeGreaterThan(0)

      // TXT 没有 cfi，锚点只剩「块序号」这一级
      expect(persisted!.cfi).toBeNull()
      expect(Number.isInteger(persisted!.chapterIndex)).toBe(true)
      expect(Math.round(persisted!.percent * 100)).toBe(Number.parseInt(fourthPage, 10))
    } finally {
      await first.close()
    }

    const second = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      // 先确认回到书架再点开：渲染进程还没挂载完就点，会点空
      await expect(page.getByRole('heading', { name: '书架' })).toBeVisible()
      await expect(page.getByRole('heading', { name: '山海经' })).toBeVisible()

      await page.getByRole('button', { name: '山海经', exact: true }).click()
      const reader = page.getByRole('region', { name: '正在阅读《山海经》' })
      await expect(reader.locator('.reader__viewport--text')).toBeVisible()

      // 续读落在第 4 页而不是块首，所以再翻一页正好是上次的第 5 页。
      // 反解用的是精确算术（percent 不取整），同一窗口尺寸下逐字相等是安全的。
      await reader.getByRole('button', { name: '下一页' }).click()
      await expect(reader.locator('.reader__percent')).toHaveText(fifthPage)
    } finally {
      await second.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

/**
 * TXT 没有导航文档，目录只能靠正文里的「第 N 章」标题行现算。这一条盯住两件事：
 * 标题行确实被认成了目录项，且点了之后正文真的换到了那一章。
 */
test('TXT 的目录由标题行生成，点击条目后正文跳到对应章节', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const txtPath = join(sourceDir, '围城.txt')
  const chapters = Array.from(
    { length: 4 },
    (_unused, index) => `第 ${index + 1} 章\n${'甲乙丙丁戊己庚辛'.repeat(200)}`
  )
  await writeFile(txtPath, chapters.join('\n\n'), 'utf8')

  try {
    const app = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await stubFilePicker(app, [txtPath])
      await page.getByRole('button', { name: '导入书籍' }).click()
      await page.getByRole('button', { name: '围城', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《围城》' })
      await expect(reader.locator('.txt-reader__block')).toContainText('第 1 章')

      const drawer = reader.getByRole('complementary', { name: '目录' })
      await reader.getByRole('button', { name: '目录', exact: true }).click()
      await expect(drawer.locator('.toc-list__item')).toHaveText([
        '第 1 章',
        '第 2 章',
        '第 3 章',
        '第 4 章'
      ])

      await drawer.getByRole('button', { name: '第 4 章', exact: true }).click()

      await expect(drawer).toHaveCount(0)
      await expect(reader.locator('.txt-reader__block')).toContainText('第 4 章')
      await expect(reader.locator('.txt-reader__block')).not.toContainText('第 1 章')
      await expect(reader.locator('.reader__error')).toHaveCount(0)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

/**
 * GB18030 兜底解码是「猜」：猜对了没人知道，猜错了得说一声，否则用户看到的是
 * 一片乱码却没有解释。这里用一个 GB18030 里非法的 0xff 逼出替换字符。
 */
test('TXT 编码解不干净时给出提示，正文照旧显示', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const txtPath = join(sourceDir, '残卷.txt')
  // 「第一章」的 GB18030 字节 + 空行 + 两个 0xff（GB18030 不认这个首字节）
  await writeFile(
    txtPath,
    new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0a, 0x0a, 0xff, 0xff, 0x0a])
  )

  try {
    const app = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await stubFilePicker(app, [txtPath])
      await page.getByRole('button', { name: '导入书籍' }).click()
      await page.getByRole('button', { name: '残卷', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《残卷》' })
      await expect(reader.locator('.reader__notice')).toContainText('可能不是 UTF-8')
      // 提示不是错误：能解的字节照样显示，阅读不被打断
      await expect(reader.locator('.reader__error')).toHaveCount(0)
      await expect(reader.locator('.txt-reader__block')).toContainText('第一章')
      await expect(reader.getByText('阅读中')).toBeVisible()
    } finally {
      await app.close()
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

/**
 * 正文页边上的书签标记数量。epub.js 的 mark 产物是宿主文档里一枚 ref="epubjs-mk" 的 <a>，
 * 第三个参数 data 里的键会写成 dataset 属性 —— 靠它才能和别处的 mark 区分开。
 */
const bookmarkMarkCount = (page: Page): Promise<number> =>
  page.locator('.reader__viewport [ref="epubjs-mk"][data-bookmark="true"]').count()

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
      await toolbar.getByRole('button', { name: '绿色', exact: true }).click()

      // 划线先落到本地列表再落到存档上，两处都要能看到才算真的画下去了
      await expect.poll(() => highlightMarkCount(page)).toBeGreaterThan(0)
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)

      const snapshot = JSON.parse(await readFile(annotationsPath, 'utf8')) as {
        annotations: { kind: string; cfi: string; excerpt: string; color: string }[]
      }
      const saved = snapshot.annotations[0]
      expect(saved?.kind).toBe('highlight')
      // 摘录与 cfi 都得来自真实的 iframe 选区，不是界面上拼出来的占位
      expect(saved?.excerpt).toBe('第 1 章正文')
      expect(saved?.cfi).toMatch(/^epubcfi\(/)
      // 点的是哪个色块就得存下哪个颜色，不能一律回落到默认色
      expect(saved?.color).toBe('green')

      await reader.getByRole('button', { name: '注解', exact: true }).click()
      const drawer = reader.getByRole('complementary', { name: '注解' })
      await expect(drawer.locator('.annotation-list__kind')).toHaveText('绿色划线')
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
      // 重新画回来的标记也要带上存档里的配色，不能一律用 epub.js 自带的黄色
      await expect
        .poll(() => page.locator('.reader__viewport [ref^="epubjs-hl"]').first().getAttribute('fill'))
        .toBe(highlightFill('green'))

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
      await toolbar.getByRole('button', { name: '黄色', exact: true }).click()
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
      await expect(page.getByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toBeVisible()

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

test('把已有的划线换成另一种颜色，正文与存档一起换', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })
  const annotationsPath = join(userDataDir, 'annotations.json')

  /** 正文里那条划线标记的 fill：marks-pane 是逐个 setAttribute 上去的，只能读属性。 */
  const markFill = (page: Page) =>
    page.locator('.reader__viewport [ref^="epubjs-hl"]').first().getAttribute('fill')

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
      await toolbar.getByRole('button', { name: '黄色', exact: true }).click()
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)
      await expect.poll(() => highlightMarkCount(page)).toBe(1)
    } finally {
      await first.close()
    }

    // 重启后再改：走的是「读存档 → 重新画回正文 → 重新选区」，而不是刚划完的内存状态
    const second = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.getByRole('button', { name: '三体', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader.getByText('阅读中')).toBeVisible()
      await expect.poll(() => highlightMarkCount(page)).toBe(1)

      expect(await selectChapterText(page)).toBe(true)
      const toolbar = reader.getByRole('toolbar', { name: '选中文字的操作' })
      await expect(toolbar).toBeVisible()
      // 「删除划线」可点，说明这段选区被认成了已有划线；下面点色块走的是改色而不是新建
      await expect(toolbar.getByRole('button', { name: '删除划线', exact: true })).toBeEnabled()
      await toolbar.getByRole('button', { name: '蓝色', exact: true }).click()

      // 先等新配色真的画上去，再数标记条数：这时若旧标记没被擦掉就会是 2
      await expect.poll(() => markFill(page)).toBe(highlightFill('blue'))
      expect(await highlightMarkCount(page)).toBe(1)

      // 存档里还是同一条，只是配色换了；改色要是「删了重划」这里会变成 2
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)
      const snapshot = JSON.parse(await readFile(annotationsPath, 'utf8')) as {
        annotations: { color: string }[]
      }
      expect(snapshot.annotations[0]?.color).toBe('blue')
    } finally {
      await second.close()
    }

    const third = await electron.launch({ args: [mainEntry], env: launchEnv(userDataDir) })
    try {
      const page = await third.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.getByRole('button', { name: '三体', exact: true }).click()

      const reader = page.getByRole('region', { name: '正在阅读《三体》' })
      await expect(reader.getByText('阅读中')).toBeVisible()

      // 换过的颜色要真的落进了存档，而不是只在这一次会话里生效
      await expect.poll(() => markFill(page)).toBe(highlightFill('blue'))
      expect(await highlightMarkCount(page)).toBe(1)
    } finally {
      await third.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('书签标记落在正文页边，翻页后摘掉、翻回来重新挂上，移除书签也会摘掉', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })
  const annotationsPath = join(userDataDir, 'annotations.json')

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
      expect(await bookmarkMarkCount(page)).toBe(0)

      await reader.getByRole('button', { name: '加书签' }).click()

      const mark = page.locator('.reader__viewport [ref="epubjs-mk"][data-bookmark="true"]')
      await expect(mark).toHaveCount(1)
      // epub.js 造出来的 <a> 自身尺寸是 0，只有样式表命中才有尺寸 ——
      // 这条断言同时钉住「标记真的画在正文上」和「CSS 确实生效」
      await expect(mark).toBeVisible()
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)

      // 样例书每章一个 spread：翻页会跨 section，旧 view 连同它的标记一起销毁
      await reader.getByRole('button', { name: '下一页' }).click()
      await expect.poll(() => chapterText(page)).toContain('第 2 章正文')
      await expect.poll(() => bookmarkMarkCount(page)).toBe(0)

      // 翻回来时 view 会重建，epub.js 的 hooks.render 必须把书签重新挂上去
      await reader.getByRole('button', { name: '上一页' }).click()
      await expect.poll(() => chapterText(page)).toContain('第 1 章正文')
      await expect.poll(() => bookmarkMarkCount(page)).toBe(1)

      await reader.getByRole('button', { name: '移除书签' }).click()
      await expect.poll(() => bookmarkMarkCount(page)).toBe(0)
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(0)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('导出把这本书的注解写成一份能认出来的文件，建议的文件名来自书名', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })
  const annotationsPath = join(userDataDir, 'annotations.json')
  const exportDir = await mkdtemp(join(tmpdir(), 'ebook-reader-export-'))

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

      // 两枚书签落在两页上，导出的文件里才真的有多条而不是恰好一条
      await reader.getByRole('button', { name: '加书签' }).click()
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)
      await reader.getByRole('button', { name: '下一页' }).click()
      await expect.poll(() => chapterText(page)).toContain('第 2 章正文')
      await reader.getByRole('button', { name: '加书签' }).click()
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(2)

      await stubSaveDialog(app, exportDir)
      await reader.getByRole('button', { name: '注解' }).click()
      await reader.getByRole('button', { name: '导出注解' }).click()
      await expect(reader.getByText('已导出 2 条注解')).toBeVisible()

      // 文件名由应用建议（书名清洗后 + 后缀），stub 只是把它落到测试目录里
      const exported = join(exportDir, '三体-注解.json')
      const payload = JSON.parse(await readFile(exported, 'utf8')) as {
        kind: string
        version: number
        book: { id: string; title: string }
        annotations: { kind: string; cfi: string }[]
      }

      expect(payload.kind).toBe('ebook-reader-annotations')
      expect(payload.version).toBe(1)
      expect(payload.book.title).toBe('三体')
      // 只带 bookId，不落书库里的绝对路径 —— 导出文件是能被转发的
      expect(JSON.stringify(payload)).not.toContain('C:/library/')
      expect(payload.annotations).toHaveLength(2)
      expect(payload.annotations.every((item) => item.kind === 'bookmark')).toBe(true)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
    await rm(exportDir, { recursive: true, force: true })
  }
})

test('导出的注解能导入回来并重新画到正文上，再导入一次不会变成两份', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'ebook-reader-e2e-'))
  const sourceDir = join(userDataDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
  const epubPath = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体', author: '刘慈欣' })
  const annotationsPath = join(userDataDir, 'annotations.json')
  const exportDir = await mkdtemp(join(tmpdir(), 'ebook-reader-export-'))
  const exported = join(exportDir, '三体-注解.json')

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
      const drawer = reader.getByRole('complementary', { name: '注解' })
      await expect(reader.getByText('阅读中')).toBeVisible()
      await expect.poll(() => chapterText(page)).toContain('第 1 章正文')

      await reader.getByRole('button', { name: '加书签' }).click()
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)
      await expect.poll(() => bookmarkMarkCount(page)).toBe(1)

      await stubSaveDialog(app, exportDir)
      await reader.getByRole('button', { name: '注解' }).click()
      await reader.getByRole('button', { name: '导出注解' }).click()
      await expect(reader.getByText('已导出 1 条注解')).toBeVisible()
      await readFile(exported, 'utf8')

      // 抽屉铺在右半屏，先收起来再去点工具条上的按钮
      await drawer.getByRole('button', { name: '关闭注解' }).click()
      await reader.getByRole('button', { name: '移除书签' }).click()
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(0)
      await expect.poll(() => bookmarkMarkCount(page)).toBe(0)

      await stubFilePicker(app, [exported])
      await reader.getByRole('button', { name: '注解' }).click()
      await drawer.getByRole('button', { name: '导入注解' }).click()

      await expect(drawer.getByText('新增 1 条')).toBeVisible()
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)
      // 重新载入后正文上要真的画回来，光有存档不算
      await expect.poll(() => bookmarkMarkCount(page)).toBe(1)
      await expect(drawer.getByRole('listitem')).toHaveCount(1)

      // 再导入一次：同一条已经在书里了，必须跳过而不是多出一条
      await drawer.getByRole('button', { name: '导入注解' }).click()
      await expect(drawer.getByText('跳过 1 条（本机已有）')).toBeVisible()
      await expect.poll(() => savedAnnotationCount(annotationsPath)).toBe(1)
      await expect(drawer.getByRole('listitem')).toHaveCount(1)
    } finally {
      await app.close()
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true })
    await rm(exportDir, { recursive: true, force: true })
  }
})
