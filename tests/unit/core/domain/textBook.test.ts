import { describe, expect, it } from 'vitest'
import { locatorFromRelocation, percentFromRelocation } from '@core/domain/progress'
import {
  MAX_TEXT_BYTES,
  TEXT_BLOCK_MAX_CHARS,
  blockPageFromLocator,
  normalizeNewlines,
  splitTextIntoBlocks
} from '@core/domain/textBook'

describe('normalizeNewlines', () => {
  it('把 CRLF 与裸 CR 都归一成 LF', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('已经是 LF 的文本原样返回', () => {
    expect(normalizeNewlines('a\n\nb')).toBe('a\n\nb')
  })

  it('空串不炸', () => {
    expect(normalizeNewlines('')).toBe('')
  })
})

describe('splitTextIntoBlocks', () => {
  it('空文本与纯空白文本都返回 0 块，让调用方去走空文件提示', () => {
    expect(splitTextIntoBlocks('')).toEqual([])
    expect(splitTextIntoBlocks('   \n\t\n  ')).toEqual([])
    expect(splitTextIntoBlocks('\r\n\r\n')).toEqual([])
  })

  it('按空行分段，每段一块', () => {
    expect(splitTextIntoBlocks('第一章\n\n第二章\n\n第三章')).toEqual([
      '第一章',
      '第二章',
      '第三章'
    ])
  })

  it('段内的单换行是换行而不是分段', () => {
    expect(splitTextIntoBlocks('第一行\n第二行')).toEqual(['第一行\n第二行'])
  })

  it('段内空行只有空格时也算分段', () => {
    expect(splitTextIntoBlocks('第一章\n \t\n第二章')).toEqual(['第一章', '第二章'])
  })

  it('CRLF 文件按同样的规则分段', () => {
    expect(splitTextIntoBlocks('第一章\r\n\r\n第二章')).toEqual(['第一章', '第二章'])
  })

  it('保留全角空格，中文 TXT 常拿它做首行缩进', () => {
    expect(splitTextIntoBlocks('\u3000\u3000缩进一段')).toEqual(['\u3000\u3000缩进一段'])
  })

  it('削掉段首段尾的 ASCII 空白', () => {
    expect(splitTextIntoBlocks('\n\n  \n第一章\n  \n\n')).toEqual(['第一章'])
  })

  it('超出上限的段落按行打包成多块', () => {
    const blocks = splitTextIntoBlocks('aaa\nbbb\nccc', 7)

    expect(blocks).toEqual(['aaa\nbbb', 'ccc'])
    expect(blocks.every((block) => block.length <= 7)).toBe(true)
  })

  it('单行本身就超限时按上限硬切，不让任何一块越界', () => {
    const blocks = splitTextIntoBlocks('x'.repeat(25), 10)

    expect(blocks).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
  })

  it('打包装不下时开新块，且组合起来仍是原文', () => {
    const source = Array.from({ length: 50 }, (_value, index) => `第${index}行`).join('\n')
    const blocks = splitTextIntoBlocks(source, 40)

    expect(blocks.length).toBeGreaterThan(1)
    expect(blocks.every((block) => block.length <= 40)).toBe(true)
    // 打包只挪动边界，不丢内容：拼回去就是原文
    expect(blocks.join('\n')).toBe(source)
  })

  it('上限非法时回落到默认上限，不会让整个文件不切块', () => {
    expect(splitTextIntoBlocks('abc', 0)).toEqual(['a', 'b', 'c'])
    expect(splitTextIntoBlocks('abc', Number.NaN)).toEqual(['abc'])
    expect(splitTextIntoBlocks('abc', Number.POSITIVE_INFINITY)).toEqual(['abc'])
    expect(splitTextIntoBlocks('x'.repeat(TEXT_BLOCK_MAX_CHARS + 1), Number.NaN).length).toBe(2)
  })

  it('默认上限就是导出的常量', () => {
    expect(TEXT_BLOCK_MAX_CHARS).toBe(200_000)
    expect(splitTextIntoBlocks('x'.repeat(TEXT_BLOCK_MAX_CHARS + 1)).length).toBe(2)
  })

  it('字节上限是 16 MB', () => {
    expect(MAX_TEXT_BYTES).toBe(16 * 1024 * 1024)
  })
})

describe('blockPageFromLocator', () => {
  it('块内只有一页时直接给第一页', () => {
    expect(blockPageFromLocator({ chapterIndex: 3, percent: 0.9 }, 10, 1)).toBe(1)
  })

  it('没有块时给第一页，不做除零', () => {
    expect(blockPageFromLocator({ chapterIndex: 0, percent: 0.5 }, 0, 10)).toBe(1)
  })

  it('chapterIndex 为 null 时按第 0 块解释', () => {
    expect(blockPageFromLocator({ chapterIndex: null, percent: 0 }, 10, 5)).toBe(1)
  })

  it('chapterIndex 越界时夹到有效范围', () => {
    expect(blockPageFromLocator({ chapterIndex: 99, percent: 1 }, 4, 5)).toBe(5)
    expect(blockPageFromLocator({ chapterIndex: -3, percent: 0 }, 4, 5)).toBe(1)
  })

  it('反解与 percentFromRelocation 往返，误差不超过一个百分点', () => {
    const blockCount = 8
    const totalPages = 6

    for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
      for (let page = 1; page <= totalPages; page += 1) {
        const percent = percentFromRelocation({
          chapterIndex: blockIndex,
          page,
          totalPages,
          spineCount: blockCount,
          cfi: null,
          atEnd: false
        })
        // 反解出的页码可能因四舍五入偏一页，但换算回进度必须落在容差内
        const restored = blockPageFromLocator({ chapterIndex: blockIndex, percent }, blockCount, totalPages)
        const restoredPercent = percentFromRelocation({
          chapterIndex: blockIndex,
          page: restored,
          totalPages,
          spineCount: blockCount,
          cfi: null,
          atEnd: false
        })

        expect(Math.abs(restoredPercent - percent)).toBeLessThanOrEqual(0.01)
      }
    }
  })

  it('落在块首时反解回第一页', () => {
    const blockCount = 5
    const totalPages = 4
    const percent = percentFromRelocation({
      chapterIndex: 2,
      page: 1,
      totalPages,
      spineCount: blockCount,
      cfi: null,
      atEnd: false
    })

    expect(blockPageFromLocator({ chapterIndex: 2, percent }, blockCount, totalPages)).toBe(1)
  })

  it('落在块尾时反解回最后一页', () => {
    const blockCount = 5
    const totalPages = 4
    const percent = percentFromRelocation({
      chapterIndex: 2,
      page: 4,
      totalPages,
      spineCount: blockCount,
      cfi: null,
      atEnd: false
    })

    expect(blockPageFromLocator({ chapterIndex: 2, percent }, blockCount, totalPages)).toBe(4)
  })

  it('接得住 locatorFromRelocation 存下来的进度', () => {
    const saved = locatorFromRelocation(
      { cfi: null, chapterIndex: 3, page: 3, totalPages: 5, spineCount: 10, atEnd: false },
      1_700_000_000_000
    )

    expect(saved.cfi).toBeNull()
    expect(saved.chapterIndex).toBe(3)
    expect(saved.updatedAt).toBe(1_700_000_000_000)
    expect(blockPageFromLocator(saved, 10, 5)).toBe(3)
  })

  it('进度越界时不产出越界页码', () => {
    expect(blockPageFromLocator({ chapterIndex: 0, percent: 5 }, 10, 4)).toBe(4)
    expect(blockPageFromLocator({ chapterIndex: 0, percent: -1 }, 10, 4)).toBe(1)
  })
})
