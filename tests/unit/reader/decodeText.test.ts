import { describe, expect, it } from 'vitest'
import { decodeText, decodeTextBytes } from '@renderer/reader/decodeText'

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

describe('decodeText', () => {
  it('回报实际用的编码，好让界面能说清按什么打开的', () => {
    expect(decodeText(utf8('第一章')).encoding).toBe('utf-8')
    expect(decodeText(bytes(0xd6, 0xd0, 0xce, 0xc4)).encoding).toBe('gb18030')
    expect(decodeText(bytes(0xff, 0xfe, 0x2d, 0x4e)).encoding).toBe('utf-16le')
    expect(decodeText(bytes(0xfe, 0xff, 0x4e, 0x2d)).encoding).toBe('utf-16be')
  })

  it('干干净净解出来的文本不算可疑，不该弹编码提示', () => {
    expect(decodeText(utf8('第一章 三体')).uncertain).toBe(false)
    expect(decodeText(bytes(0xd6, 0xd0, 0xce, 0xc4)).uncertain).toBe(false)
    expect(decodeText(new Uint8Array(0)).uncertain).toBe(false)
  })

  it('坏字节变成替换字符后判为可疑，这是提示编码不对的判据', () => {
    // 0xFF 在任何编码里都不是合法起始字节，宽容解码只能给出 U+FFFD
    expect(decodeText(bytes(0xff, 0xff)).uncertain).toBe(true)
  })

  it('GB18030 也解不干净的混合文件同样判为可疑', () => {
    const mixed = concat(utf8('中文'), bytes(0xff, 0xff))

    expect(decodeText(mixed).uncertain).toBe(true)
  })

  it('文本本身就写了 U+FFFD 时不抛异常，只是被当成可疑（已知的多报）', () => {
    // 宽容解码的坏字节与文件自带的 U+FFFD 长得一模一样，只有结果可以看。
    // 输入真带替换字符的概率极小，不为它再加一级判断。
    const decoded = decodeText(utf8('前\uFFFD后'))

    expect(decoded.text).toBe('前\uFFFD后')
    expect(decoded.uncertain).toBe(true)
  })

  it('decodeTextBytes 只是取文本的薄包装，两条路径结果一致', () => {
    const samples = [utf8('第一章 三体'), bytes(0xd6, 0xd0, 0xce, 0xc4), bytes(0xff, 0xfe, 0x2d, 0x4e)]

    for (const sample of samples) {
      expect(decodeTextBytes(sample)).toBe(decodeText(sample).text)
    }
  })

  it('空字节的编码标注为 utf-8，界面按它有值就放心显示', () => {
    expect(decodeText(new Uint8Array(0))).toEqual({ text: '', encoding: 'utf-8', uncertain: false })
  })
})

function concat(head: Uint8Array, tail: Uint8Array): Uint8Array {
  const merged = new Uint8Array(head.length + tail.length)
  merged.set(head, 0)
  merged.set(tail, head.length)
  return merged
}
