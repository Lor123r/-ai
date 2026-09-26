import { expect, test, type Page } from '@playwright/test'
import { buildEpubBytes } from '../tests/support/epubFixture'

/**
 * 手机竖屏下的排版回归。
 *
 * 为什么单独一组：桌面窗口宽 1280，手机宽 360。渲染层里所有「够不够宽」
 * 的假设在桌面上都不会暴露，只有把视口压到手机尺寸才看得见。
 *
 * 真机（荣耀 X40，MagicOS）上暴露的两个问题：
 * 1. 书架卡片被挤成一列，封面拉得极高；
 * 2. 阅读器正文退化成竖排窄条 —— epub.js 分页时容器高度算成 0，
 *    于是把内容塞进一个极窄的列，CJK 触发竖排回退。
 *
 * 这一组用 360×800 复现，断言「正文横向铺开」而不是「有没有渲染」。
 */

const PHONE = { width: 360, height: 800 }

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
        await new Promise((resolve) => setTimeout(resolve, 1500))
      } finally {
        HTMLInputElement.prototype.click = originalClick
      }
    },
    { name: fileName, data: [...bytes] }
  )
}

async function seedShelf(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  const bytes = await buildEpubBytes({ title: '三体', author: '刘慈欣' })
  await importEpub(page, '三体.epub', bytes)
  await expect(page.getByRole('heading', { name: '三体' })).toBeVisible({ timeout: 15_000 })
}

test.use({ viewport: PHONE })

test('手机竖屏下书架不横向溢出', async ({ page }) => {
  await seedShelf(page)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('手机竖屏下书架是多列，封面不被拉成一屏高', async ({ page }) => {
  await seedShelf(page)

  // 一列时封面按 3/4 比例会高到 400px 以上，一屏放不下第二本书
  const coverHeight = await page.evaluate(() => {
    const cover = document.querySelector('.book-card__cover')
    return cover ? cover.getBoundingClientRect().height : 0
  })
  expect(coverHeight).toBeGreaterThan(0)
  expect(coverHeight).toBeLessThan(PHONE.height * 0.5)
})

test('手机竖屏下阅读器头部不横向溢出', async ({ page }) => {
  await seedShelf(page)

  await page.getByRole('heading', { name: '三体' }).click()
  await expect(page.getByRole('button', { name: '返回书架' })).toBeVisible({ timeout: 15_000 })

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('手机竖屏下正文横向铺开，不退化成竖排窄条', async ({ page }) => {
  await seedShelf(page)

  await page.getByRole('heading', { name: '三体' }).click()
  await expect(page.getByRole('button', { name: '返回书架' })).toBeVisible({ timeout: 15_000 })

  // 等 epub.js 把正文 iframe 建出来
  await expect.poll(() => page.frames().length, { timeout: 15_000 }).toBeGreaterThan(1)

  // 正文 iframe 的宽度必须接近视口宽度。退化时它会缩成几十像素的窄条。
  const frameWidth = await page.evaluate(() => {
    const iframe = document.querySelector('.reader__viewport iframe')
    if (!iframe) return 0
    return iframe.getBoundingClientRect().width
  })

  expect(frameWidth).toBeGreaterThan(PHONE.width * 0.6)
})

test('手机竖屏下正文容器有确定高度，epub.js 才能分页', async ({ page }) => {
  await seedShelf(page)

  await page.getByRole('heading', { name: '三体' }).click()
  await expect(page.getByRole('button', { name: '返回书架' })).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => page.frames().length, { timeout: 15_000 }).toBeGreaterThan(1)

  // 高度塌陷是竖排的根因：epub.js 拿不到高度就算不出每页多少字
  const height = await page.evaluate(() => {
    const viewport = document.querySelector('.reader__viewport')
    return viewport ? viewport.getBoundingClientRect().height : 0
  })

  expect(height).toBeGreaterThan(200)
})

/*
 * 这一条守的是「为什么」而不是「什么样」。
 *
 * 上面几条断言在桌面 Chromium 里改不改 CSS 都是绿的 —— 桌面会把 flex 子元素的
 * height: 100% 解析成 flex 算出来的高度。安卓 WebView 不会，它按 auto 处理，
 * 于是 epub.js 量到 0，正文退化成竖排窄条。真机才暴露，本地复现不了。
 *
 * 所以这里直接断言结构：正文容器的高度必须由 flex 给出，不能依赖百分比解析。
 * 谁把 flex: 1 改回 height: 100%，这条就会红。
 */
test('正文容器的高度由 flex 给出，不依赖百分比解析', async ({ page }) => {
  await seedShelf(page)

  await page.getByRole('heading', { name: '三体' }).click()
  await expect(page.getByRole('button', { name: '返回书架' })).toBeVisible({ timeout: 15_000 })

  const styles = await page.evaluate(() => {
    const viewport = document.querySelector('.reader__viewport')
    const body = document.querySelector('.reader__body')
    if (!viewport || !body) return null
    const viewportStyle = getComputedStyle(viewport)
    const bodyStyle = getComputedStyle(body)
    return {
      viewportFlexGrow: viewportStyle.flexGrow,
      viewportHeight: viewportStyle.height,
      bodyDisplay: bodyStyle.display,
      bodyFlexDirection: bodyStyle.flexDirection
    }
  })

  expect(styles).not.toBeNull()
  // 高度来自 flex-grow，而不是 height: 100%
  expect(styles!.viewportFlexGrow).toBe('1')
  expect(styles!.viewportHeight).not.toBe('100%')
  // 父级必须是 flex 容器，flex: 1 才有意义
  expect(styles!.bodyDisplay).toBe('flex')
  expect(styles!.bodyFlexDirection).toBe('column')
})
