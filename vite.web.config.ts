import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

/**
 * 浏览器 / 安卓 WebView 的构建配置。
 *
 * 与 electron.vite.config.ts 的 renderer 段共用同一套别名与插件，差别只有两点：
 * 1. 入口是 src/web/index.html（多一个「装 window.api」的引导脚本）；
 * 2. 注入 __APP_VERSION__，因为浏览器里没有 app.getVersion() 可问。
 *
 * 刻意不把这份配置并进 electron.vite.config.ts：那个文件是 electron-vite 的格式，
 * 加一个非 Electron 的 target 会让它变成两种构建系统的混合体，读的人要先分辨
 * 「这一段是给谁的」。分开之后，删掉整个 src/web 目录就能干净地回到纯 Electron 项目。
 */
export default defineConfig({
  root: resolve('src/web'),
  base: './',
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@core': resolve('src/core'),
      '@shared': resolve('src/shared')
    }
  },
  plugins: [react()]
})
