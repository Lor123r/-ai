import { describe, expect, it } from 'vitest'
import { decodeTextBytes } from '@renderer/reader/decodeText'

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

/** 用宿主自带的 TextEncoder 造 UTF-8 字节，避免手写多字节序列写错。 */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('decodeTextBytes', () => {
  it('空字节返回空串', () => {
    expect(decodeTextBytes(new Uint8Array(0))).toBe('')
  })

  it('解不含 BOM 的 UTF-8', () => {
    expect(decodeTextBytes(utf8('第一章 三体'))).toBe('第一章 三体')
  })

  it('跳过 UTF-8 BOM', () => {
    expect(decodeTextBytes(concat(bytes(0xef, 0xbb, 0xbf), utf8('你好')))).toBe('你好')
  })

  it('按 UTF-16LE BOM 解码', () => {
    // '中' = U+4E2D → LE 字节序 2D 4E
    expect(decodeTextBytes(bytes(0xff, 0xfe, 0x2d, 0x4e))).toBe('中')
  })

  it('按 UTF-16BE BOM 解码', () => {
    expect(decodeTextBytes(bytes(0xfe, 0xff, 0x4e, 0x2d))).toBe('中')
  })

  it('BOM 之后紧跟正文，BOM 本身不会混进文本', () => {
    const encoded = concat(bytes(0xff, 0xfe), new Uint8Array([0x41, 0x00, 0x42, 0x00]))

    expect(decodeTextBytes(encoded)).toBe('AB')
  })

  it('非 UTF-8 字节回退到 gb18030，中文不再解成乱码', () => {
    // 「中文」的 GBK 字节
    expect(decodeTextBytes(bytes(0xd6, 0xd0, 0xce, 0xc4))).toBe('中文')
  })

  it('GBK 字节被 UTF-8 严格模式拒绝后仍然走得通', () => {
    const mixed = concat(bytes(0xd6, 0xd0, 0xce, 0xc4), utf8(' tail'))

    expect(decodeTextBytes(mixed)).toBe('中文 tail')
  })

  it('坏字节不抛异常，最多变成替换字符', () => {
    // 0xFF 在任何编码里都不是合法起始字节
    const decoded = decodeTextBytes(bytes(0xff, 0xff))

    expect(typeof decoded).toBe('string')
  })

  it('BOM 的编码不认识时退化成宽容解码而不是抛错', () => {
    // utf-16le 只有奇数个正文字节，截断的高位字节会变成替换字符
    const decoded = decodeTextBytes(bytes(0xff, 0xfe, 0x41, 0x00, 0x42))

    expect(decoded.startsWith('A')).toBe(true)
  })

  it('换行原样保留，归一化不在这里做', () => {
    expect(decodeTextBytes(utf8('a\r\n\r\nb'))).toBe('a\r\n\r\nb')
  })
})

function concat(head: Uint8Array, tail: Uint8Array): Uint8Array {
  const merged = new Uint8Array(head.length + tail.length)
  merged.set(head, 0)
  merged.set(tail, head.length)
  return merged
}
