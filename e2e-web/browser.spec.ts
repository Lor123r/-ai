import { expect, test, type Page } from '@playwright/test'
import { buildEpubBytes } from '../tests/support/epubFixture'

/**
 * 浏览器宿主的端到端测试。
 *
 * 这一套要回答的问题只有一个：**把宿主从 Electron 换成纯浏览器，应用还能不能跑通。**
 * 它不重复 Electron 那套的细节断言（那些在 e2e/app.spec.ts 里），只覆盖「宿主换了
 * 之后哪些环节可能断」：
 *
 * 1. window.api 由 src/web 装上，渲染层认不认；
 * 2. IndexedDB 能不能替代主进程的 JSON 存档（含刷新后仍在）；
 * 3. epub.js 在普通 Chromium 页面里能不能渲染、翻页 —— 这是安卓风险点 1；
 * 4. 没有 preload、没有 IPC 时，导入与注解还能不能走通。
 *
 * 跑通之后，「安卓风险」就只剩 WebView 版本差异与 SAF 文件访问，而不是整个宿主假设。
 */

/**
 * 把一份 EPUB 字节喂给页面的导入流程，绕开原生文件选择框。
 *
 * 应用是通过 `input.click()` 现造一个 input 的，所以这里临时替换
 * `HTMLInputElement.prototype.click`，在它被调用时把文件塞进去并派发 change。
 * 用 DataTransfer 构造 FileList 是浏览器里唯一能凭空造出 FileList 的办法。
 */
async function importEpub(page: Page, fileName: string, bytes: Uint8Array): Promise<void> {
  await page.evaluate(
    async ({ name, data }) => {
      const file = new File([new Uint8Array(data)], name, { type: 'application/epub+zip' })
      const transfer = new DataTransfer()
      transfer.items.add(file)

      const originalClick = HTMLInputElement.prototype.click
      HTMLInputElement.prototype.click = function patched(this: HTMLInputElement) {
        if (this.type === 'file') {
          this.files = transfer.files
          this.dispatchEvent(new Event('change'))
          return
        }
        return originalClick.call(this)
      }

      try {
        const button = [...document.querySelectorAll('button')].find((item) =>
          item.textContent?.includes('导入书籍')
        )
        if (!button) throw new Error('找不到导入按钮')
        ;(button as HTMLButtonElement).click()
        // 等导入流程把 IndexedDB 写完
        await new Promise((resolve) => setTimeout(resolve, 1500))
      } finally {
        HTMLInputElement.prototype.click = originalClick
      }
    },
    { name: fileName, data: [...bytes] }
  )
}

/** 导入一本样书并等它出现在书架上，返回它的 bookId。 */
async function seedShelf(page: Page): Promise<string> {
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  const bytes = await buildEpubBytes({ title: '三体', author: '刘慈欣' })
  await importEpub(page, '三体.epub', bytes)
  await expect(page.getByRole('heading', { name: '三体' })).toBeVisible({ timeout: 15_000 })

  const bookId = await page.evaluate(async () => (await window.api!.books.list())[0]?.id ?? null)
  expect(bookId).not.toBeNull()
  return bookId as string
}

test('浏览器宿主能启动，window.api 由 src/web 装上', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible()
  await expect(page.getByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toBeVisible()

  // 关键断言：渲染层认出了宿主。没有这一条，后面所有测试都可能是在跑内存回落实现。
  const hasBridge = await page.evaluate(() => typeof window.api === 'object' && window.api !== null)
  expect(hasBridge).toBe(true)

  const hasBooks = await page.evaluate(async () => Array.isArray(await window.api!.books.list()))
  expect(hasBooks).toBe(true)
})

test('导入 EPUB 后进入书架，刷新页面后仍在（IndexedDB 持久化）', async ({ page }) => {
  await seedShelf(page)

  // 刷新等价于 Electron 那套里的「重启应用」：内存全丢，只剩 IndexedDB
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('heading', { name: '三体' })).toBeVisible()
  await expect(page.getByText('书架还是空的，导入 EPUB 或 TXT 后就会出现在这里。')).toHaveCount(0)
})

test('点开书进入阅读器，epub.js 在普通 Chromium 里渲染出 iframe', async ({ page }) => {
  await seedShelf(page)

  await page.getByRole('heading', { name: '三体' }).click()
  await expect(page.getByRole('button', { name: '返回书架' })).toBeVisible({ timeout: 15_000 })

  // 安卓风险点 1 的第一半：epub.js 在非 Electron 的 Chromium 页面里能不能渲染。
  // 它把正文放进 iframe，所以 frame 数必须大于 1（主页面 + 至少一个正文 frame）。
  await expect
    .poll(() => page.frames().length, { timeout: 15_000 })
    .toBeGreaterThan(1)

  await page.getByRole('button', { name: '返回书架' }).click()
  await expect(page.getByRole('heading', { name: '书架' })).toBeVisible()
})

test('阅读进度落盘，刷新后从上次位置继续', async ({ page }) => {
  const bookId = await seedShelf(page)

  await page.evaluate(async (id) => {
    await window.api!.books.saveLocator(id, {
      cfi: 'epubcfi(/6/4!/4/2)',
      percent: 0.42,
      chapterIndex: 1,
      updatedAt: Date.now()
    })
  }, bookId)

  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  const locator = await page.evaluate((id) => window.api!.books.getLocator(id), bookId)
  expect(locator).toMatchObject({ percent: 0.42, chapterIndex: 1 })
})

test('注解能存进 IndexedDB 并在刷新后读回，非法 id 被挡下', async ({ page }) => {
  const bookId = await seedShelf(page)

  await page.evaluate(async (id) => {
    await window.api!.annotations.save({
      id: 'a1',
      bookId: id,
      kind: 'highlight',
      cfi: 'epubcfi(/6/4!/4/2)',
      chapterHref: 'ch1.xhtml',
      percent: 0.25,
      note: '浏览器宿主笔记',
      excerpt: '摘录',
      color: 'yellow',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000
    })
  }, bookId)

  // 非法 id 必须被挡下 —— 与主进程同款的信任边界校验
  const rejected = await page.evaluate(async (id) => {
    try {
      await window.api!.annotations.save({
        id: 'a 1',
        bookId: id,
        kind: 'bookmark',
        cfi: 'epubcfi(/6/4!/4/2)'
      })
      return false
    } catch {
      return true
    }
  }, bookId)
  expect(rejected).toBe(true)

  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  const annotations = await page.evaluate((id) => window.api!.annotations.listByBook(id), bookId)
  expect(annotations).toHaveLength(1)
  expect(annotations[0]).toMatchObject({ id: 'a1', kind: 'highlight', color: 'yellow' })
})

test('阅读设置落盘，刷新后依然生效', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  await page.evaluate(async () => {
    const current = await window.api!.settings.load()
    await window.api!.settings.save({ ...current, fontSize: 22 })
  })

  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  const reloaded = await page.evaluate(() => window.api!.settings.load())
  expect(reloaded).toMatchObject({ fontSize: 22 })
})

test('更新检查在浏览器宿主里安静地不可用', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  const result = await page.evaluate(() => window.api!.update.check())
  expect(result).toEqual({ status: 'unavailable', reason: 'not-packaged' })

  // 不该在书架上留下任何提示
  await expect(page.getByText(/有新版本/)).toHaveCount(0)
})
