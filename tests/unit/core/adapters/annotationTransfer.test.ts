import { describe, expect, it } from 'vitest'
import { serializeAnnotations } from '@core/adapters/annotationSnapshot'
import {
  ANNOTATION_TRANSFER_KIND,
  ANNOTATION_TRANSFER_VERSION,
  AnnotationTransferFormatError,
  parseAnnotationTransfer,
  serializeAnnotationTransfer
} from '@core/adapters/annotationTransfer'
import { MAX_BOOK_ID_LENGTH, createBookmark, createHighlight, type Annotation } from '@core/domain/annotation'

const NOW = 1_700_000_000_000
const BOOK = { id: 'book-1', title: '三体' }

function bookmark(id: string, createdAt: number, bookId = BOOK.id): Annotation {
  return createBookmark({ id, bookId, cfi: 'epubcfi(/6/4!/4/2)' }, createdAt)
}

function highlight(id: string, createdAt: number, bookId = BOOK.id): Annotation {
  return createHighlight(
    { id, bookId, cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)', excerpt: '正文片段', color: 'blue' },
    createdAt
  )
}

/** 改一份刚导出的信封信封里的字段，用来逐个验证各类脏数据。 */
function tamper(patch: Record<string, unknown>, annotations: Annotation[] = [bookmark('a', NOW)]): unknown {
  const envelope = JSON.parse(serializeAnnotationTransfer(BOOK, annotations, NOW)) as Record<string, unknown>
  return { ...envelope, ...patch }
}

function parseTampered(patch: Record<string, unknown>, annotations?: Annotation[]) {
  return parseAnnotationTransfer(JSON.stringify(tamper(patch, annotations)), NOW)
}

/** 只改条目本身的字段，信封保持合法。 */
function tamperEntry(patch: Record<string, unknown>): string {
  const envelope = JSON.parse(serializeAnnotationTransfer(BOOK, [bookmark('a', NOW)], NOW)) as {
    annotations: Record<string, unknown>[]
  }
  envelope.annotations[0] = { ...envelope.annotations[0]!, ...patch }
  return JSON.stringify(envelope)
}

describe('serializeAnnotationTransfer', () => {
  it('写信封的身份标记、出版时间与条目列表', () => {
    const parsed = JSON.parse(serializeAnnotationTransfer(BOOK, [bookmark('a', NOW - 1000)], NOW)) as Record<
      string,
      unknown
    >

    expect(parsed.kind).toBe(ANNOTATION_TRANSFER_KIND)
    expect(parsed.version).toBe(ANNOTATION_TRANSFER_VERSION)
    expect(parsed.book).toEqual({ id: 'book-1', title: '三体' })
    expect(parsed.exportedAt).toBe(NOW)
    expect(parsed.annotations).toHaveLength(1)
  })

  it('末尾带换行，方便用文本编辑器直接查看导出文件', () => {
    expect(serializeAnnotationTransfer(BOOK, [], NOW).endsWith('\n')).toBe(true)
  })

  it('按列表顺序写出，同一批注解无论传入顺序如何都逐字节相同', () => {
    const items = [bookmark('a', NOW - 2000), highlight('h', NOW - 1000), bookmark('b', NOW - 3000)]

    const text = serializeAnnotationTransfer(BOOK, items, NOW)

    expect(text).toBe(serializeAnnotationTransfer(BOOK, [...items].reverse(), NOW))
    const parsed = JSON.parse(text) as { annotations: Annotation[] }
    expect(parsed.annotations.map((item) => item.id)).toEqual(['h', 'a', 'b'])
  })

  it('书名里的控制字符与多余空白会被清掉，超长会截断', () => {
    const long = '超'.repeat(300)
    const parsed = JSON.parse(
      serializeAnnotationTransfer({ id: 'book-1', title: `三\u0000体\n  第${long}` }, [], NOW)
    ) as { book: { title: string } }

    expect(parsed.book.title.startsWith('三 体 第超')).toBe(true)
    expect(parsed.book.title).not.toMatch(/[\u0000-\u001f]/)
    expect(parsed.book.title.length).toBe(200)
  })

  it('书名不是字符串时写成空串，不把非法值带进文件', () => {
    const parsed = JSON.parse(
      serializeAnnotationTransfer({ id: 'book-1', title: 42 as unknown as string }, [], NOW)
    ) as { book: { title: string } }

    expect(parsed.book.title).toBe('')
  })

  it('导出条目的字段集与存档完全一致', () => {
    const items = [bookmark('a', NOW), highlight('h', NOW)]

    const transfer = JSON.parse(serializeAnnotationTransfer(BOOK, items, NOW)) as { annotations: unknown[] }
    const snapshot = JSON.parse(serializeAnnotations(items)) as { annotations: unknown[] }

    expect(transfer.annotations).toEqual(snapshot.annotations)
  })
})

describe('parseAnnotationTransfer', () => {
  it('能读回刚导出的内容，且条目与原始注解等价', () => {
    const items = [bookmark('a', NOW - 2000), highlight('h', NOW - 1000)]

    const parsed = parseAnnotationTransfer(serializeAnnotationTransfer(BOOK, items, NOW), NOW)

    expect(parsed.book).toEqual(BOOK)
    expect(parsed.dropped).toBe(0)
    // 导出时按列表顺序排过序，这里逐条对回原对象，确认没有字段在往返中丢失或变味
    expect(parsed.annotations).toEqual([items[1], items[0]])
  })

  it('空条目列表是合法的，解析出空数组', () => {
    const parsed = parseAnnotationTransfer(serializeAnnotationTransfer(BOOK, [], NOW), NOW)

    expect(parsed.annotations).toEqual([])
    expect(parsed.dropped).toBe(0)
  })

  it('不是 JSON 时整份拒绝', () => {
    expect(() => parseAnnotationTransfer('{ 这不是 json', NOW)).toThrow(AnnotationTransferFormatError)
  })

  it('根节点不是对象时整份拒绝', () => {
    expect(() => parseAnnotationTransfer('[]', NOW)).toThrow(AnnotationTransferFormatError)
  })

  it('把应用自己的存档当导入文件时整份拒绝', () => {
    // 全库存档的形状与交换格式几乎一样，只有 kind 挡得住
    expect(() => parseAnnotationTransfer(serializeAnnotations([bookmark('a', NOW)]), NOW)).toThrow(
      AnnotationTransferFormatError
    )
  })

  it('kind 不对时整份拒绝', () => {
    expect(() => parseTampered({ kind: 'ebok-reader-annotations' })).toThrow(AnnotationTransferFormatError)
  })

  it('版本号不匹配时整份拒绝，不尝试兼容读取', () => {
    expect(() => parseTampered({ version: ANNOTATION_TRANSFER_VERSION + 1 })).toThrow(AnnotationTransferFormatError)
    expect(() => parseTampered({ version: '1' })).toThrow(AnnotationTransferFormatError)
  })

  it('信封里没有可用的书籍标识时整份拒绝', () => {
    expect(() => parseTampered({ book: null })).toThrow(AnnotationTransferFormatError)
    expect(() => parseTampered({ book: { title: '三体' } })).toThrow(AnnotationTransferFormatError)
    expect(() => parseTampered({ book: { id: '   ' } })).toThrow(AnnotationTransferFormatError)
    expect(() => parseTampered({ book: { id: 'x'.repeat(MAX_BOOK_ID_LENGTH + 1) } })).toThrow(
      AnnotationTransferFormatError
    )
  })

  it('缺少注解列表时整份拒绝，而不是当成空列表', () => {
    // 当成空列表会让用户看到「导入成功，新增 0 条」，反而去怀疑自己的操作
    expect(() => parseTampered({ annotations: undefined })).toThrow(AnnotationTransferFormatError)
    expect(() => parseTampered({ annotations: {} })).toThrow(AnnotationTransferFormatError)
  })

  it('条目自带的 bookId 一律被信封覆盖', () => {
    const text = serializeAnnotationTransfer(BOOK, [bookmark('a', NOW, '另一本书')], NOW)

    const parsed = parseAnnotationTransfer(text, NOW)

    expect(parsed.annotations[0]?.bookId).toBe('book-1')
  })

  it('单个条目坏掉时跳过它并计数，其余照常读出来', () => {
    const envelope = JSON.parse(
      serializeAnnotationTransfer(BOOK, [bookmark('a', NOW - 1000), bookmark('b', NOW - 2000)], NOW)
    ) as { annotations: Record<string, unknown>[] }

    const broken: unknown[] = [
      ...envelope.annotations,
      { ...envelope.annotations[0]!, id: '带空格 的 id' },
      '不是对象'
    ]

    const parsed = parseAnnotationTransfer(JSON.stringify({ ...envelope, annotations: broken }), NOW)

    expect(parsed.annotations.map((item) => item.id)).toEqual(['a', 'b'])
    expect(parsed.dropped).toBe(2)
  })

  it('条目字段非法时按单条丢弃，不影响信封判定', () => {
    const parsed = parseAnnotationTransfer(tamperEntry({ cfi: '' }), NOW)

    expect(parsed.annotations).toEqual([])
    expect(parsed.dropped).toBe(1)
  })

  it('书名缺失时回落空串，不影响解析', () => {
    const parsed = parseAnnotationTransfer(
      JSON.stringify(tamper({ book: { id: 'book-1' } })),
      NOW
    )

    expect(parsed.book.title).toBe('')
  })

  it('书名不是字符串时回落空串', () => {
    const parsed = parseAnnotationTransfer(JSON.stringify(tamper({ book: { id: 'book-1', title: 7 } })), NOW)

    expect(parsed.book.title).toBe('')
  })
})
