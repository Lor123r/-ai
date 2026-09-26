import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@renderer/App'
import '@renderer/styles/global.css'
import { createWebBridge } from './createWebBridge'

/**
 * 浏览器 / 安卓 WebView 的入口。
 *
 * 与 Electron 的入口（src/renderer/src/main.tsx）只差一件事：这里在挂载 React 之前
 * 先把 window.api 装上。渲染层本身完全不知道自己在哪个宿主里跑 —— 它读 window.api，
 * 有就用，没有就回落到内存实现。
 *
 * 顺序不能反：create* 工厂是在组件首次渲染时读 window.api 的，
 * 晚一步装上就会有一批组件拿到内存实现，表现为「导入的书重启后不见了」。
 */
const bridge = createWebBridge(__APP_VERSION__)
window.api = bridge

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
