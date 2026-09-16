import { afterEach, describe, expect, it, vi } from 'vitest'
import { isValidAnnotationId } from '@core/domain/annotation'
import { createAnnotationId } from '@renderer/reader/annotationId'

/** 只实现 randomUUID 的 WebCrypto：安全上下文下的典型形态。 */
function randomUuidOnly(uuid: string): unknown {
  return { randomUUID: () => uuid }
}

/** 只有 getRandomValues 的 WebCrypto：randomUUID 被安全上下文挡住时的形态。 */
function randomValuesOnly(fill: number): unknown {
  return {
    getRandomValues: (array: Uint8Array) => array.fill(fill)
  }
}

function stubCrypto(value: unknown): void {
  vi.stubGlobal('crypto', value)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createAnnotationId 的降级顺序', () => {
  it('有 randomUUID 时直接用平台生成的 UUID', () => {
    stubCrypto(randomUuidOnly('8f14e45f-ea0f-4a1e-9c4d-2b3c4d5e6f70'))

    expect(createAnnotationId()).toBe('8f14e45f-ea0f-4a1e-9c4d-2b3c4d5e6f70')
  })

  it('randomUUID 缺席时退到 getRandomValues，输出十六进制而不是 UUID', () => {
    stubCrypto(randomValuesOnly(0xab))

    expect(createAnnotationId()).toBe('ab'.repeat(16))
  })

  it('WebCrypto 整个缺席时退到 Math.random，长度与字符集仍然守规矩', () => {
    stubCrypto(undefined)

    expect(createAnnotationId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('crypto 存在但没有可用的随机接口时也能出结果', () => {
    stubCrypto({})

    expect(createAnnotationId()).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('createAnnotationId 与 core 的契约', () => {
  it('三档输出都能通过 core 的校验', () => {
    const branches: [string, unknown][] = [
      ['randomUUID', randomUuidOnly('8f14e45f-ea0f-4a1e-9c4d-2b3c4d5e6f70')],
      ['getRandomValues', randomValuesOnly(0x00)],
      ['Math.random', undefined]
    ]

    for (const [branch, crypto] of branches) {
      stubCrypto(crypto)
      const id = createAnnotationId()
      // 带上分支名，失败时一眼看出是哪一档破了契约
      expect([branch, isValidAnnotationId(id)]).toEqual([branch, true])
    }
  })

  it('回退出来的 id 不会顶到 core 的长度上限', () => {
    stubCrypto(randomValuesOnly(0xff))
    const id = createAnnotationId()

    expect(id).toHaveLength(32)
    expect(id.length).toBeLessThan(128)
  })

  it('连续生成不重复', () => {
    stubCrypto(undefined)

    const ids = new Set(Array.from({ length: 200 }, () => createAnnotationId()))

    expect(ids.size).toBe(200)
  })

  it('回退路径之间互不干扰：一次调用只吃一档的随机源', () => {
    const randomUUID = vi.fn(() => '8f14e45f-ea0f-4a1e-9c4d-2b3c4d5e6f70')
    const getRandomValues = vi.fn((array: Uint8Array) => array.fill(0x11))
    stubCrypto({ randomUUID, getRandomValues })

    expect(createAnnotationId()).toBe('8f14e45f-ea0f-4a1e-9c4d-2b3c4d5e6f70')
    expect(randomUUID).toHaveBeenCalledTimes(1)
    expect(getRandomValues).not.toHaveBeenCalled()
  })
})
