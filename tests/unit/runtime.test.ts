import { describe, expect, it } from 'vitest'
import { formatRuntimeLabel, getRuntimeVersions } from '@renderer/platform/runtime'
import { installFakeBridge } from './support/fakeBridge'

describe('getRuntimeVersions', () => {
  it('无 window.api 时返回 undefined', () => {
    expect(window.api).toBeUndefined()
    expect(getRuntimeVersions()).toBeUndefined()
  })

  it('有 window.api 时返回版本信息', () => {
    const cleanup = installFakeBridge({ node: '24.21.0', chrome: '140.0.0', electron: '38.2.0' })

    try {
      expect(getRuntimeVersions()).toEqual({ node: '24.21.0', chrome: '140.0.0', electron: '38.2.0' })
    } finally {
      cleanup()
    }
  })
})

describe('formatRuntimeLabel', () => {
  it('缺失版本信息时给出预览模式文案', () => {
    expect(formatRuntimeLabel(undefined)).toBe('浏览器预览模式')
  })

  it('有版本信息时拼出 Electron 与 Chromium 版本', () => {
    expect(formatRuntimeLabel({ node: '24.21.0', chrome: '140.0.0', electron: '38.2.0' })).toBe(
      'Electron 38.2.0 · Chromium 140.0.0'
    )
  })
})
