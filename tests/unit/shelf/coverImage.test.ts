import { describe, expect, it } from 'vitest'
import { toCoverDataUrl } from '@renderer/shelf/coverImage'

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('toCoverDataUrl', () => {
  it('把字节编成可显示的 data URL', () => {
    expect(toCoverDataUrl({ bytes: bytesOf('PNG'), mediaType: 'image/png' })).toBe(
      'data:image/png;base64,UE5H'
    )
  })

  it('超过一个分块也能正确拼接', () => {
    const source = 'a'.repeat(20_000)
    const url = toCoverDataUrl({ bytes: bytesOf(source), mediaType: 'image/png' })

    const base64 = url.slice('data:image/png;base64,'.length)
    expect(Buffer.from(base64, 'base64').toString('utf8')).toBe(source)
  })

  it('空字节得到只有前缀的地址', () => {
    expect(toCoverDataUrl({ bytes: new Uint8Array(), mediaType: 'image/jpeg' })).toBe(
      'data:image/jpeg;base64,'
    )
  })
})
