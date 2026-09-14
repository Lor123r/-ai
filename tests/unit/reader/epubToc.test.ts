import { describe, expect, it } from 'vitest'
import type { EpubBook } from '@renderer/reader/createEpubBook'
import { readToc } from '@renderer/reader/epubToc'

function fakeBook(options: { toc?: unknown; spineHrefs?: string[] } = {}): EpubBook {
  return {
    ready: Promise.resolve(),
    spine: {
      length: options.spineHrefs?.length ?? 0,
      each: (callback) => {
        for (const href of options.spineHrefs ?? []) callback({ href })
      }
    },
    navigation: options.toc === undefined ? undefined : { toc: options.toc as never },
    renderTo: () => {
      throw new Error('readToc 不该渲染')
    },
    destroy: () => undefined
  }
}

describe('readToc', () => {
  it('没有导航时返回空目录', () => {
    expect(readToc(fakeBook())).toEqual([])
    expect(readToc(fakeBook({ toc: [] }))).toEqual([])
  })

  it('读出标题、层级与 href', () => {
    const book = fakeBook({
      toc: [
        { id: 'a', href: 'ch1.xhtml', label: '第一章' },
        { id: 'b', href: 'ch2.xhtml', label: '第二章', subitems: [{ id: 'b1', href: 'ch2.xhtml#s1', label: '第一节' }] }
      ],
      spineHrefs: ['ch1.xhtml', 'ch2.xhtml']
    })

    expect(readToc(book).map((entry) => [entry.label, entry.href, entry.depth])).toEqual([
      ['第一章', 'ch1.xhtml', 0],
      ['第二章', 'ch2.xhtml', 0],
      ['第一节', 'ch2.xhtml#s1', 1]
    ])
  })

  it('目录里的相对链接会被对齐到 spine 的路径', () => {
    const book = fakeBook({
      toc: [{ href: '../OEBPS/ch1.xhtml#top', label: '第一章' }],
      spineHrefs: ['Text/ch1.xhtml', 'Text/ch2.xhtml']
    })

    expect(readToc(book)[0]!.href).toBe('Text/ch1.xhtml#top')
  })

  it('拿不到 spine 信息时保留原始 href，交给 epub.js 处理', () => {
    const book = fakeBook({ toc: [{ href: '../ch1.xhtml', label: '第一章' }] })

    expect(readToc(book)[0]!.href).toBe('../ch1.xhtml')
  })

  it('导航数据畸形时不抛错，只丢弃坏项', () => {
    const book = fakeBook({ toc: [null, 'x', { label: '没有 href' }, { href: 'ch1.xhtml', label: '好的' }] })

    expect(readToc(book).map((entry) => entry.label)).toEqual(['好的'])
  })
})
