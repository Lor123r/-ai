import { createAnnotationTransfer } from '@renderer/data/createAnnotationTransfer'
import { createFakeAnnotationTransfer, createFakeBridge } from '../support/fakeBridge'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(() => {
  delete window.api
})

describe('createAnnotationTransfer', () => {
  it('没有 preload 桥时返回 null：浏览器预览里这两个入口必须藏起来', () => {
    expect(createAnnotationTransfer()).toBeNull()
  })

  it('存在 preload 桥时返回桥上的那一个，不做包装', () => {
    const transfer = createFakeAnnotationTransfer()
    window.api = { ...createFakeBridge(), annotationTransfer: transfer }

    expect(createAnnotationTransfer()).toBe(transfer)
  })

  it('桥在但没有交换能力时也返回 null：开发期 preload 可能是旧产物', () => {
    window.api = { ...createFakeBridge(), annotationTransfer: undefined as never }

    expect(createAnnotationTransfer()).toBeNull()
  })

  it('每次调用都重新读 window.api，替换桥之后立刻生效', () => {
    expect(createAnnotationTransfer()).toBeNull()

    const transfer = createFakeAnnotationTransfer()
    window.api = { ...createFakeBridge(), annotationTransfer: transfer }

    expect(createAnnotationTransfer()).toBe(transfer)
  })
})
