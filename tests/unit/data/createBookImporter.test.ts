import { afterEach, describe, expect, it } from 'vitest'
import { createBookImporter } from '@renderer/data/createBookImporter'
import { createFakeBridge, createFakeImporter } from '../support/fakeBridge'

afterEach(() => {
  delete window.api
})

describe('createBookImporter', () => {
  it('没有 preload 桥时返回 null，让 UI 隐藏导入入口', () => {
    expect(createBookImporter()).toBeNull()
  })

  it('桥存在时直接复用桥上的导入器', () => {
    const importer = createFakeImporter()
    window.api = { ...createFakeBridge(), library: importer }

    expect(createBookImporter()).toBe(importer)
  })
})
