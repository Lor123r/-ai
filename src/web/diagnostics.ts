/**
 * 真机上的兜底诊断面板。
 *
 * 为什么需要它：安卓真机没有 adb 时，白屏就是白屏——看不到任何原因。
 * 这个模块把 console.error / window.onerror / unhandledrejection 收集起来，
 * 画成一个可折叠的浮层，让「没有调试通道」也能定位问题。
 *
 * 只在浏览器宿主里挂载（Electron 有自己的 devtools，不需要这个）。
 * 默认收起，只在真的捕获到错误时才自动展开——正常使用时它不打扰人。
 */

type Entry = {
  kind: 'error' | 'rejection' | 'console'
  text: string
  at: string
}

const entries: Entry[] = []
let panel: HTMLElement | undefined
let list: HTMLElement | undefined
let title: HTMLElement | undefined
let toggle: HTMLButtonElement | undefined
let expanded = false

function stamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function sync(): void {
  if (!title || !toggle || !list) return
  title.textContent = `诊断 (${entries.length})`
  toggle.textContent = expanded ? '收起' : '展开'
  list.style.display = expanded ? 'block' : 'none'
}

function render(): void {
  if (!list) return
  list.textContent = ''
  for (const entry of entries) {
    const row = document.createElement('div')
    row.style.cssText =
      'padding:4px 0;border-bottom:1px solid #333;white-space:pre-wrap;word-break:break-all'
    row.textContent = `[${entry.at}] ${entry.kind}: ${entry.text}`
    list.appendChild(row)
  }
}

function ensurePanel(): void {
  // 面板可能被外部从 DOM 里摘掉（测试重置、宿主重挂载）。
  // 只认「还在文档里」的引用，否则重建——不然诊断会静默失效。
  if (panel && panel.isConnected) return

  panel = document.createElement('div')
  panel.id = 'diagnostic-panel'
  panel.style.cssText = [
    'position:fixed',
    'left:0',
    'right:0',
    'bottom:0',
    'max-height:45vh',
    'overflow:auto',
    'z-index:2147483647',
    'background:rgba(0,0,0,.92)',
    'color:#f88',
    'font:12px/1.5 ui-monospace,Consolas,monospace',
    'padding:8px',
    'box-sizing:border-box'
  ].join(';')

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px'

  title = document.createElement('strong')
  title.style.color = '#fff'

  toggle = document.createElement('button')
  toggle.style.cssText = 'font:inherit;padding:2px 10px;cursor:pointer'
  toggle.addEventListener('click', () => {
    expanded = !expanded
    sync()
  })

  header.append(title, toggle)

  list = document.createElement('div')
  list.style.cssText = 'margin-top:6px;display:none'

  panel.append(header, list)
  document.body.appendChild(panel)
  sync()
}

function push(kind: Entry['kind'], value: unknown): void {
  entries.push({ kind, text: describe(value), at: stamp() })
  ensurePanel()
  render()
  // 出错时自动展开：用户不需要知道要点哪里
  expanded = true
  sync()
}

export function installDiagnostics(): void {
  window.addEventListener('error', (event) => {
    push('error', event.error ?? event.message)
  })

  window.addEventListener('unhandledrejection', (event) => {
    push('rejection', event.reason)
  })

  const originalError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    push('console', args.map(describe).join(' '))
    originalError(...args)
  }
}
