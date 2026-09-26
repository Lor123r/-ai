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
  await expect(page.locator('.reader')).toBeAttached({ timeout: 15_000 })

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('手机竖屏下正文横向铺开，不退化成竖排窄条', async ({ page }) => {
  await seedShelf(page)

  await page.getByRole('heading', { name: '三体' }).click()
  await expect(page.locator('.reader')).toBeAttached({ timeout: 15_000 })

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
  await expect(page.locator('.reader')).toBeAttached({ timeout: 15_000 })
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
  await expect(page.locator('.reader')).toBeAttached({ timeout: 15_000 })

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

/*
 * 翻页手势。
 *
 * 手机上底栏按钮被 CSS 收起（见 global.css 的窄屏断点），翻页只剩手势一条路，
 * 所以这一组是手机端能不能读书的底线，不是锦上添花。
 *
 * 两个容易踩空的地方，测试要盯住：
 *
 * 1. **正文在 iframe 里。** 只把监听绑在父文档上，点在正文上毫无反应 ——
 *    而正文恰好占了屏幕绝大部分。所以每条断言都打在 iframe 内部。
 * 2. **滑动不能顺带触发点击。** 一次滑动如果既算滑动又算点击，会翻两页。
 */

/**
 * 打开《三体》并等正文 iframe 就绪。
 *
 * 不能等「返回书架」按钮可见：手机上顶栏默认收起（display: none），
 * 那个按钮虽然存在但不可见。改等阅读器外壳挂上、正文 iframe 建出来。
 */
async function openReader(page: Page): Promise<void> {
  await seedShelf(page)
  await page.getByRole('heading', { name: '三体' }).click()
  await expect(page.locator('.reader')).toBeAttached({ timeout: 15_000 })
  await expect.poll(() => page.frames().length, { timeout: 15_000 }).toBeGreaterThan(1)
}

/** 正文 iframe 的 bounding box；手势要打在它上面。 */
async function bodyBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('.reader__viewport iframe').boundingBox()
  if (!box) throw new Error('正文 iframe 还没有布局')
  return box
}

/**
 * 在正文 iframe 内部派发一次 pointer 手势。
 *
 * 为什么不用 page.mouse：鼠标移到 iframe 上时 Playwright 的可操作性检查会卡住
 * （跨文档的命中测试拿不到稳定结果），表现为 mouse.move 一直不返回、测试超时。
 * 直接在 iframe 的 document 上派发 PointerEvent 既绕开这个问题，又更贴近真实：
 * 手势监听本来就绑在 iframe 的 document 上，这里验证的正是那条路径。
 */
async function gesture(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  await page.evaluate(
    ({ from, to }) => {
      const iframe = document.querySelector('.reader__viewport iframe')
      const doc = iframe?.contentDocument
      if (!doc) throw new Error('拿不到正文 iframe 的 document')

      const fire = (type: string, x: number, y: number): void => {
        doc.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            pointerId: 1,
            pointerType: 'touch',
            isPrimary: true
          })
        )
      }

      fire('pointerdown', from.x, from.y)
      fire('pointerup', to.x, to.y)
    },
    { from, to }
  )
}

/** 在正文 iframe 内部派发一次点击（按下与抬起同一点）。 */
async function tap(page: Page, at: { x: number; y: number }): Promise<void> {
  await gesture(page, at, at)
}

/**
 * 当前阅读进度百分比，用来判断有没有真的翻页。
 *
 * 用 textContent 而不是 innerText：进度挂在顶栏里，而顶栏在手机上默认
 * display: none，innerText 对隐藏元素返回空串。
 */
async function progress(page: Page): Promise<number> {
  const text = await page.locator('.reader__percent').textContent()
  const match = text?.match(/(\d+(?:\.\d+)?)\s*%/)
  if (!match) throw new Error(`读不出进度：${text}`)
  return Number(match[1])
}

test('在正文上向左滑动翻到下一页', async ({ page }) => {
  await openReader(page)
  const box = await bodyBox(page)
  const y = box.y + box.height / 2
  const before = await progress(page)

  // 从右侧往左划，横向位移远大于纵向，落在滑动判定里
  await gesture(page, { x: box.x + box.width * 0.8, y }, { x: box.x + box.width * 0.2, y })

  await expect.poll(() => progress(page), { timeout: 10_000 }).toBeGreaterThan(before)
})

test('在正文上向右滑动翻回上一页', async ({ page }) => {
  await openReader(page)
  const box = await bodyBox(page)
  const y = box.y + box.height / 2

  // 先往后翻一页，才有「上一页」可回
  await gesture(page, { x: box.x + box.width * 0.8, y }, { x: box.x + box.width * 0.2, y })
  await expect.poll(() => progress(page), { timeout: 10_000 }).toBeGreaterThan(0)
  const after = await progress(page)

  await gesture(page, { x: box.x + box.width * 0.2, y }, { x: box.x + box.width * 0.8, y })

  await expect.poll(() => progress(page), { timeout: 10_000 }).toBeLessThan(after)
})

test('一次滑动只翻一页，不会顺带触发点击翻页', async ({ page }) => {
  await openReader(page)
  const box = await bodyBox(page)
  const y = box.y + box.height / 2

  // 从最右侧划到最左侧：起点落在「下一页」点击区，终点落在「上一页」点击区。
  // 如果滑动之后抬起又被当成点击，这里会先翻过去再翻回来，进度原地不动。
  await gesture(page, { x: box.x + box.width * 0.95, y }, { x: box.x + box.width * 0.05, y })

  await expect.poll(() => progress(page), { timeout: 10_000 }).toBeGreaterThan(0)
})

test('点击正文右侧翻到下一页', async ({ page }) => {
  await openReader(page)
  const box = await bodyBox(page)
  const before = await progress(page)

  await tap(page, { x: box.x + box.width * 0.9, y: box.y + box.height / 2 })

  await expect.poll(() => progress(page), { timeout: 10_000 }).toBeGreaterThan(before)
})

test('点击正文左侧翻回上一页', async ({ page }) => {
  await openReader(page)
  const box = await bodyBox(page)
  const y = box.y + box.height / 2

  await tap(page, { x: box.x + box.width * 0.9, y })
  await expect.poll(() => progress(page), { timeout: 10_000 }).toBeGreaterThan(0)
  const after = await progress(page)

  await tap(page, { x: box.x + box.width * 0.1, y })

  await expect.poll(() => progress(page), { timeout: 10_000 }).toBeLessThan(after)
})

test('手机上顶栏与底栏默认收起，点正文中间唤出', async ({ page }) => {
  await openReader(page)

  const header = page.locator('.reader__header')
  const controls = page.locator('.reader__controls')

  // 默认收起：display: none，不占位也不可聚焦
  await expect(header).toBeHidden()
  await expect(controls).toBeHidden()

  const box = await bodyBox(page)
  await tap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 })

  await expect(header).toBeVisible()
  await expect(controls).toBeVisible()

  // 再点一次收起。必须重新量一次正文：顶栏出现后正文被往下挤，
  // 沿用旧坐标会点到 iframe 外面，事件根本到不了监听器。
  const shrunk = await bodyBox(page)
  await tap(page, { x: shrunk.x + shrunk.width / 2, y: shrunk.y + shrunk.height / 2 })
  await expect(header).toBeHidden()
})

test('收起顶栏后正文拿到全部高度', async ({ page }) => {
  await openReader(page)

  const box = await bodyBox(page)
  // 顶栏收起时正文应该几乎占满视口高度
  expect(box.height).toBeGreaterThan(PHONE.height * 0.85)
})

test('桌面宽度下顶栏与底栏始终显示', async ({ page }) => {
  // 这一条要覆盖 test.use 的 360×800，单独放大视口
  await page.setViewportSize({ width: 1280, height: 800 })
  await openReader(page)

  await expect(page.locator('.reader__header')).toBeVisible()
  await expect(page.locator('.reader__controls')).toBeVisible()
  // 桌面端按钮仍然可点，鼠标用户不依赖手势
  await expect(page.getByRole('button', { name: '下一页' })).toBeVisible()
})
