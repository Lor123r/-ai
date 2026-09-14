import { describe, expect, it } from 'vitest'
import { TOC_LIMITS, flattenToc, resolveTocTarget } from '@core/domain/toc'

describe('flattenToc', () => {
  it('把嵌套目录摊平成带层级的列表', () => {
    const entries = flattenToc([
      { id: 'a', href: 'ch1.xhtml', label: '第一章' },
      {
        id: 'b',
        href: 'ch2.xhtml',
        label: '第二章',
        subitems: [
          { id: 'b1', href: 'ch2.xhtml#s1', label: '第一节', subitems: [{ id: 'b1a', href: 'ch2.xhtml#s1a', label: '小节' }] }
        ]
      }
    ])

    expect(entries.map((entry) => [entry.label, entry.depth])).toEqual([
      ['第一章', 0],
      ['第二章', 0],
      ['第一节', 1],
      ['小节', 2]
    ])
    expect(entries.map((entry) => entry.href)).toEqual(['ch1.xhtml', 'ch2.xhtml', 'ch2.xhtml#s1', 'ch2.xhtml#s1a'])
  })

  it('每项都拿到互不相同的稳定 id，方便 React 渲染与测试定位', () => {
    const entries = flattenToc([
      { href: 'a.xhtml', label: 'A' },
      { href: 'b.xhtml', label: 'B' },
      { href: 'c.xhtml', label: 'C' }
    ])

    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3)
  })

  it('没有 href 的项不生成条目，但它的子项照常展开', () => {
    const entries = flattenToc([
      { label: '第一部', subitems: [{ href: 'a.xhtml', label: '第一章' }] },
      { href: 'b.xhtml', label: '第二章' }
    ])

    expect(entries.map((entry) => entry.label)).toEqual(['第一章', '第二章'])
    // 分组项被跳过，深度按树上的位置算，所以第一章仍是第 1 层
    expect(entries.map((entry) => entry.depth)).toEqual([1, 0])
  })

  it('空白 href 与空白 label 都被当作缺失处理', () => {
    const entries = flattenToc([{ href: '   ', label: '空' }, { href: 'a.xhtml', label: '  ' }])

    expect(entries).toHaveLength(1)
    expect(entries[0]!.label).toBe('a.xhtml')
  })

  it('标签缺失时用 href 末尾的文件名兜底', () => {
    const entries = flattenToc([
      { href: 'Text/chapter-1.xhtml' },
      { href: 'Text/chapter-2.xhtml#note' },
      { href: 'Text\\chapter-3.xhtml' }
    ])

    expect(entries.map((entry) => entry.label)).toEqual(['chapter-1.xhtml', 'chapter-2.xhtml', 'chapter-3.xhtml'])
  })

  it('标签里的多余空白被压平', () => {
    const entries = flattenToc([{ href: 'a.xhtml', label: '  第一章\n\t 科学边界  ' }])

    expect(entries[0]!.label).toBe('第一章 科学边界')
  })

  it('非数组输入返回空列表而不是抛错', () => {
    expect(flattenToc(null)).toEqual([])
    expect(flattenToc(undefined)).toEqual([])
    expect(flattenToc({})).toEqual([])
    expect(flattenToc('目录')).toEqual([])
  })

  it('跳过不是对象的目录项', () => {
    const entries = flattenToc([null, 'x', 7, { href: 'a.xhtml', label: 'A' }])

    expect(entries.map((entry) => entry.label)).toEqual(['A'])
  })

  it('畸形 EPUB 里成千上万条目录项会被截断', () => {
    const huge = Array.from({ length: TOC_LIMITS.maxEntries + 250 }, (_unused, index) => ({
      href: `ch${index}.xhtml`,
      label: `第 ${index} 章`
    }))

    expect(flattenToc(huge)).toHaveLength(TOC_LIMITS.maxEntries)
  })

  it('过深的层级被截断，避免缩进把屏幕挤爆', () => {
    let branch: unknown[] = []
    for (let depth = TOC_LIMITS.maxDepth + 3; depth >= 0; depth -= 1) {
      branch = [{ href: `d${depth}.xhtml`, label: `第 ${depth} 层`, subitems: branch }]
    }

    const entries = flattenToc(branch)

    expect(entries.map((entry) => entry.label)).toEqual([
      '第 0 层',
      '第 1 层',
      '第 2 层',
      '第 3 层',
      '第 4 层'
    ])
    expect(Math.max(...entries.map((entry) => entry.depth))).toBe(TOC_LIMITS.maxDepth)
  })

  it('可以用自定义上限，方便调用方按屏幕宽度收紧', () => {
    const entries = flattenToc([{ href: 'a.xhtml', label: 'A' }, { href: 'b.xhtml', label: 'B' }], {
      maxEntries: 1,
      maxDepth: 0
    })

    expect(entries.map((entry) => entry.label)).toEqual(['A'])
  })

  it('字段顺序与原始树一致（深度优先），目录不会乱序', () => {
    const entries = flattenToc([
      { href: 'a.xhtml', label: 'A', subitems: [{ href: 'a1.xhtml', label: 'A1' }] },
      { href: 'b.xhtml', label: 'B' }
    ])

    expect(entries.map((entry) => entry.label)).toEqual(['A', 'A1', 'B'])
  })
})

describe('resolveTocTarget', () => {
  const spine = ['Text/ch1.xhtml', 'Text/ch2.xhtml', 'Text/ch3.xhtml']

  it('原样命中时保持不动（含锚点）', () => {
    expect(resolveTocTarget('Text/ch2.xhtml#part', spine)).toBe('Text/ch2.xhtml#part')
  })

  it('路径不同但文件名唯一命中时，改用 spine 的路径', () => {
    expect(resolveTocTarget('../Text/ch2.xhtml', spine)).toBe('Text/ch2.xhtml')
  })

  it('对齐路径时保留锚点', () => {
    expect(resolveTocTarget('../Text/ch2.xhtml#part2', spine)).toBe('Text/ch2.xhtml#part2')
  })

  it('文件名不唯一时原样返回，交给 epub.js 报错而不是乱跳', () => {
    const ambiguous = ['Text/ch1.xhtml', 'Notes/ch1.xhtml']

    expect(resolveTocTarget('../ch1.xhtml', ambiguous)).toBe('../ch1.xhtml')
  })

  it('完全找不到时原样返回', () => {
    expect(resolveTocTarget('Text/none.xhtml', spine)).toBe('Text/none.xhtml')
  })

  it('纯锚点链接原样返回（同文档内跳转）', () => {
    expect(resolveTocTarget('#top', spine)).toBe('#top')
  })

  it('没有 spine 信息时原样返回', () => {
    expect(resolveTocTarget('Text/ch1.xhtml', [])).toBe('Text/ch1.xhtml')
  })

  it('书内用反斜杠写路径时仍能按文件名对上号', () => {
    expect(resolveTocTarget('Text\\ch3.xhtml', spine)).toBe('Text/ch3.xhtml')
  })

  it('spine 里带查询串的 href 不会被误当成同名文件', () => {
    expect(resolveTocTarget('ch1.xhtml', ['Text/ch1.xhtml?v=2'])).toBe('ch1.xhtml')
  })
})
