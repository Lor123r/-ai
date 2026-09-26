import { defineConfig, devices } from '@playwright/test'

/**
 * 浏览器宿主的端到端配置。
 *
 * 与 playwright.config.ts（Electron 宿主）分开，因为两者的启动方式完全不同：
 * 那边用 `_electron.launch()` 起一个真实 Electron 进程，这边用 `webServer` 起一个
 * 静态服务器 + 普通 Chromium 页面。混在一个配置里没法给两边不同的 `use`。
 *
 * 为什么值得单独跑一遍：安卓 WebView 就是 Chromium。桌面 Electron 里跑通只证明
 * 「Electron 的 Chromium 能跑」，而安卓上真正会变的是 WebView 的版本、iframe 的
 * 沙箱策略、以及没有 preload 这件事。这一套测试把「宿主换成纯浏览器」这个变量
 * 单独隔离出来验证，剩下的才是真正的安卓特有风险。
 */
export default defineConfig({
  testDir: './e2e-web',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    // 本机没有下载 Playwright 自带的 Chromium（下载源不通），改用系统 Edge。
    // Edge 与安卓 WebView 同为 Chromium 内核，验证「宿主换成纯浏览器」这个变量依然成立。
    channel: 'msedge'
  },
  webServer: {
    command: 'npm run preview:web -- --port 4173 --strictPort',
    // 必须用 localhost 而不是 127.0.0.1：vite preview 默认只监听 IPv6 的 [::1]，
    // 用 IPv4 字面量探测会一直连不上，表现为 webServer 超时。
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
})
