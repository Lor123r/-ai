import { describe, expect, it } from 'vitest'
import { TEXT_TOC_LIMITS, generateTextToc } from '@core/domain/textToc'

/**
 * 判「认出来了」还是「退化成块首」的口径：认出来时标签是规整的短标题，
 * 退化时标签是块首那句正文。断言长标签就是在断言「没认出来」，
 * 读起来别扭，所以下面统一用标签列表来对比。
 */
function labels(blocks: readonly string[]): string[] {
  return generateTextToc(blocks).map((entry) => entry.label)
}

describe('generateTextToc', () => {
  it('认出「第 N 章」并记下它在哪一块、块内第几个字符', () => {
    const entries = generateTextToc(['第一章 初见', '正文一', '第二章 离别'])

    expect(entries).toEqual([
      { id: 'txt-toc-1', label: '第一章 初见', depth: 0, blockIndex: 0, offset: 0 },
      { id: 'txt-toc-2', label: '第二章 离别', depth: 0, blockIndex: 2, offset: 0 }
    ])
  })

  it('中文数字、阿拉伯数字与各种章节后缀都认', () => {
    expect(labels(['第一节', '第三回', '第 12 章', '第3卷', '第七篇', '第八部', '第九集'])).toEqual(
      ['第一节', '第三回', '第 12 章', '第3卷', '第七篇', '第八部', '第九集']
    )
  })

  it('不编号的开头也收：序章、楔子、前言、尾声、番外', () => {
    expect(labels(['序章', '楔子', '前言', '尾声', '番外 其一'])).toEqual([
      '序章',
      '楔子',
      '前言',
      '尾声',
      '番外 其一'
    ])
  })

  it('「话」「幕」这类后缀也认', () => {
    expect(labels(['第一话 相遇', '第 3 幕 落幕', '第十二回'])).toEqual([
      '第一话 相遇',
      '第 3 幕 落幕',
      '第十二回'
    ])
  })

  it('罗马数字序号也认', () => {
    expect(labels(['第Ⅰ章 序曲', '第 IV 章 终曲'])).toEqual(['第Ⅰ章 序曲', '第 IV 章 终曲'])
  })

  it('序号写在后面的「卷五」「章三」也认', () => {
    expect(labels(['卷五 风起', '章三 归途'])).toEqual(['卷五 风起', '章三 归途'])
  })

  it('英文 Chapter / Part 标题也认', () => {
    expect(labels(['Chapter 3 The Door', 'PART 12', 'part 7 尾声'])).toEqual([
      'Chapter 3 The Door',
      'PART 12',
      'part 7 尾声'
    ])
  })

  it('纯编号行带分隔符与标题正文时认', () => {
    expect(labels(['01. 起点', '2、转折', '三：归途', '4 终局'])).toEqual([
      '01. 起点',
      '2、转折',
      '三：归途',
      '4 终局'
    ])
  })

  it('光秃秃的编号不算标题，免得把页码和年份列进目录', () => {
    // 有真标题打底，才不会掉进退化分支，这条断言才真的在说「没认出来」
    const entries = generateTextToc(['第一章 初见', '01', '2024', '3.'])

    expect(entries.map((entry) => entry.blockIndex)).toEqual([0])
  })

  it('编号后面跟的是长句子就不认', () => {
    const entries = generateTextToc([
      '第一章 初见',
      '1. 他站在门口看着远处的山和云，想起很多年前的那个下午，那时候一切都还来得及'
    ])

    expect(entries.map((entry) => entry.blockIndex)).toEqual([0])
  })

  it('同一行被两条规则同时认到时只出一条', () => {
    const entries = generateTextToc(['第一章 初见\n1. 起点\n第二章 离别'])

    expect(entries.map((entry) => entry.label)).toEqual(['第一章 初见', '1. 起点', '第二章 离别'])
    expect(entries.map((entry) => entry.offset)).toEqual([0, 7, 13])
  })

  it('章节之间只换行不空行时，同一块里的多个标题照样都列出来', () => {
    const entries = generateTextToc(['第一章 初见\n正文一\n第二章 离别\n正文二'])

    expect(entries.map((entry) => entry.label)).toEqual(['第一章 初见', '第二章 离别'])
    // 第二个标题在块内的真实偏移，跳转要靠它落到位
    expect(entries.map((entry) => entry.offset)).toEqual([0, 11])
  })

  it('标题内部的多余空白收成单个空格', () => {
    expect(labels(['第一章 \t 初见'])).toEqual(['第一章 初见'])
  })

  it('整行才是标题：句子中间的「第一章」不算', () => {
    // 有一个真标题打底，就不会掉进「一个都没认出来」的退化分支，
    // 这条断言才真的在说「第二块那句没被当成标题」
    const entries = generateTextToc(['第一章 初见', '他在第一章里写到了这件事，我一直记得那句话'])

    expect(entries.map((entry) => entry.blockIndex)).toEqual([0])
  })

  it('标题长到像一句叙述就不认，免得把正文行也列进目录', () => {
    const entries = generateTextToc([
      '第一章 初见',
      '第一章 他站在门口看着远处的山和云，想起很多年前的那个下午，那时候一切都还来得及'
    ])

    expect(entries.map((entry) => entry.blockIndex)).toEqual([0])
  })

  it('数量上限生效，且不越过上限之后再回头补', () => {
    const blocks = Array.from({ length: 10 }, (_, index) => `第${index + 1}章 标题`)
    const entries = generateTextToc(blocks, { maxEntries: 3, maxLabelChars: 40 })

    expect(entries.map((entry) => entry.blockIndex)).toEqual([0, 1, 2])
  })

  it('标签超长按上限截断并留省略号', () => {
    expect(generateTextToc(['第一章 短'], { maxEntries: 500, maxLabelChars: 3 })[0]?.label).toBe(
      '第一章…'
    )
  })

  it('一个标题都没有时退化成列块首，至少还能跳段落', () => {
    const entries = generateTextToc(['甲段落的开头\n还有第二行', '乙段落'])

    expect(entries).toEqual([
      { id: 'txt-toc-1', label: '甲段落的开头 还有第二行', depth: 0, blockIndex: 0, offset: 0 },
      { id: 'txt-toc-2', label: '乙段落', depth: 0, blockIndex: 1, offset: 0 }
    ])
  })

  it('退化模式下列满上限就停', () => {
    const blocks = Array.from({ length: 10 }, (_, index) => `第 ${index + 1} 段`)
    const entries = generateTextToc(blocks, { maxEntries: 4, maxLabelChars: 40 })

    expect(entries.map((entry) => entry.blockIndex)).toEqual([0, 1, 2, 3])
  })

  it('退化模式下空块首用序号占位，标签不会是空字符串', () => {
    expect(generateTextToc(['', ''])[0]?.label).toBe('第 1 块')
  })

  it('认出标题后就不再列块首，同一块不会出现两条', () => {
    const entries = generateTextToc(['第一章 初见\n正文', '普通段落'])

    expect(entries.map((entry) => entry.blockIndex)).toEqual([0])
  })

  it('空输入与非法上限都不炸', () => {
    expect(generateTextToc([])).toEqual([])
    expect(generateTextToc(['第一章'], { maxEntries: 0, maxLabelChars: 0 })).toHaveLength(1)
    expect(
      generateTextToc(['第一章'], { maxEntries: Number.NaN, maxLabelChars: Number.NaN })
    ).toHaveLength(1)
  })

  it('默认上限对齐通用目录上限，标签长度够装下常见标题', () => {
    expect(TEXT_TOC_LIMITS).toEqual({ maxEntries: 500, maxLabelChars: 40 })
  })
})
