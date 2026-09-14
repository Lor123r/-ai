import { afterEach, describe, expect, it } from 'vitest'
import { createCoverReader } from '@renderer/data/createCoverReader'
import { createFakeBridge, createFakeCoverReader } from '../support/fakeBridge'

afterEach(() => {
  delete window.api
})

describe('createCoverReader', () => {
  it('没有 preload 桥时返回 null，书架上退化为文字占位', () => {
    expect(createCoverReader()).toBeNull()
  })

  it('桥存在时直接复用桥上的读取器', () => {
    const reader = createFakeCoverReader()
    window.api = { ...createFakeBridge(), cover: reader }

    expect(createCoverReader()).toBe(reader)
  })
})
