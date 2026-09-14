import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

test('应用启动后展示书架空态', async () => {
  const app = await electron.launch({ args: [mainEntry] })

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
})
