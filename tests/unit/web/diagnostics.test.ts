import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installDiagnostics } from '@web/diagnostics'

/**
 * 诊断面板是「没有 adb 时的唯一报错出口」，所以它自己必须可靠。
 * 这里只测三件真正会出事的事：
 * 1. 三类错误都能被捕获（error / unhandledrejection / console.error）；
 * 2. 捕获后自动展开——用户不需要知道要点哪里；
 * 3. 面板挂在 body 上，且不吞掉原始的 console.error。
 */

function panel(): HTMLElement | null {
  return document.getElementById('diagnostic-panel')
}

function panelText(): string {
  return panel()?.textContent ?? ''
}

describe('installDiagnostics', () => {
  let originalError: typeof console.error

  beforeEach(() => {
    document.body.innerHTML = ''
    originalError = console.error
  })

  afterEach(() => {
    console.error = originalError
    vi.restoreAllMocks()
  })

  it('捕获 window error 并显示在面板里', () => {
    installDiagnostics()

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom'), message: 'boom' }))

    expect(panel()).not.toBeNull()
    expect(panelText()).toContain('boom')
  })

  it('捕获未处理的 promise rejection', () => {
    installDiagnostics()

    const event = new Event('unhandledrejection') as Event & { reason?: unknown }
    event.reason = new Error('rejected')
    window.dispatchEvent(event)

    expect(panelText()).toContain('rejected')
  })

  it('捕获 console.error 且仍然转发给原始实现', () => {
    const spy = vi.fn()
    console.error = spy
    installDiagnostics()

    console.error('something failed')

    expect(panelText()).toContain('something failed')
    expect(spy).toHaveBeenCalledWith('something failed')
  })

  it('捕获后自动展开，不需要用户点击', () => {
    installDiagnostics()

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('auto'), message: 'auto' }))

    const list = panel()?.lastElementChild as HTMLElement | null
    expect(list?.style.display).toBe('block')
  })

  it('面板被外部摘掉后仍能继续工作', () => {
    installDiagnostics()
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('first'), message: 'first' }))
    expect(panelText()).toContain('first')

    // 模拟宿主重挂载：面板被移除，但模块还持有旧引用
    document.body.innerHTML = ''

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('second'), message: 'second' }))
    expect(panelText()).toContain('second')
  })

  it('没有错误时不创建面板，不打扰正常使用', () => {
    installDiagnostics()

    expect(panel()).toBeNull()
  })
})
