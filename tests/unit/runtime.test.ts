import { describe, expect, it } from 'vitest'
import { formatRuntimeLabel, getRuntimeVersions } from '@renderer/platform/runtime'
import { installFakeBridge } from './support/fakeBridge'

describe('getRuntimeVersions', () => {
  it('无 window.api 时返回 undefined', () => {
    expect(window.api).toBeUndefined()
    expect(getRuntimeVersions()).toBeUndefined()
  })

  it('有 window.api 时返回版本信息', async () => {
    const cleanup = installFakeBridge({
      app: '0.1.0',
      node: '24.21.0',
      chrome: '140.0.0',
      electron: '38.2.0'
    })

    try {
      await expect(getRuntimeVersions()).resolves.toEqual({
        app: '0.1.0',
        node: '24.21.0',
        chrome: '140.0.0',
        electron: '38.2.0'
      })
    } finally {
      cleanup()
    }
  })

  it('版本信息是异步的：应用版本只有主进程知道', () => {
    // 这条钉的是一个真实踩过的坑：preload 里直接调 `app.getVersion()`，
    // 而 `app` 是主进程专属模块，在渲染进程里是 undefined —— 抛错会把整个
    // contextBridge 一起带走，表现是 window.api 变成 undefined。
    const cleanup = installFakeBridge()

    try {
      expect(getRuntimeVersions()).toBeInstanceOf(Promise)
    } finally {
      cleanup()
    }
  })
})

describe('formatRuntimeLabel', () => {
  it('缺失版本信息时给出预览模式文案', () => {
    expect(formatRuntimeLabel(undefined)).toBe('浏览器预览模式')
  })

  it('有版本信息时拼出应用版本与 Electron 版本', () => {
    expect(
      formatRuntimeLabel({
        app: '0.1.0',
        node: '24.21.0',
        chrome: '140.0.0',
        electron: '38.2.0'
      })
    ).toBe('v0.1.0 · Electron 38.2.0')
  })

  it('不把 Chromium 与 Node 版本写进标签', () => {
    const label = formatRuntimeLabel({
      app: '1.2.3',
      node: '24.21.0',
      chrome: '140.0.0',
      electron: '38.2.0'
    })

    expect(label).not.toContain('Chromium')
    expect(label).not.toContain('24.21.0')
  })
})
