import type { CapacitorConfig } from '@capacitor/cli'

/**
 * 安卓宿主的 Capacitor 配置。
 *
 * webDir 指向 vite.web.config.ts 的产物（out/web），也就是「纯浏览器宿主」那一套。
 * 安卓 WebView 本身就是 Chromium，所以这里不需要为安卓单独写一份渲染层——
 * 这正是 e2e-web 那 7 个用例要证明的事。
 *
 * 刻意不开 server.androidScheme = 'http'：默认的 https://localhost 由
 * WebViewLocalServer 拦截并映射到 assets，能拿到 secure context，
 * crypto.subtle 才可用（bookId 的 SHA-256 依赖它）。
 */
const config: CapacitorConfig = {
  appId: 'com.lor123r.ebookreader',
  appName: '电子书阅读器',
  webDir: 'out/web',
  android: {
    // 书库是 IndexedDB，别让系统在低存储时清掉它
    allowMixedContent: false
  }
}

export default config
