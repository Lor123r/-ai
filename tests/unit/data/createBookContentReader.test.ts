import { afterEach, describe, expect, it } from 'vitest'
import { createBookContentReader } from '@renderer/data/createBookContentReader'
import { createFakeBridge, createFakeContentReader } from '../support/fakeBridge'

afterEach(() => {
  delete window.api
})

describe('createBookContentReader', () => {
  it('没有 preload 桥时返回 null，阅读器据此提示无法打开', () => {
    expect(createBookContentReader()).toBeNull()
  })

  it('桥存在时直接复用桥上的正文读取器', () => {
    const reader = createFakeContentReader()
    window.api = { ...createFakeBridge(), content: reader }

    expect(createBookContentReader()).toBe(reader)
  })
})
