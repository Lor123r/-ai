import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_FORMAT_VERSION,
  AnnotationCorruptError,
  isCorruptAnnotationError,
  parseAnnotations,
  serializeAnnotations
} from '@core/adapters/annotationSnapshot'
import {
  MAX_ANNOTATION_ID_LENGTH,
  MAX_ANNOTATIONS_PER_BOOK,
  MAX_BOOK_ID_LENGTH,
  compareAnnotationsForList,
  createBookmark,
  createHighlight,
  type Annotation
} from '@core/domain/annotation'

const NOW = 1_700_000_000_000

function bookmark(id: string, createdAt: number, bookId = 'b1'): Annotation {
  return createBookmark({ id, bookId, cfi: 'epubcfi(/6/4!/4/2)' }, createdAt)
}

function highlight(id: string, createdAt: number, bookId = 'b1'): Annotation {
  return createHighlight(
    { id, bookId, cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)', excerpt: '正文片段', color: 'blue' },
    createdAt
  )
}

/** 把单条原始数据包成一份存档文本，用来逐个验证各类脏数据。 */
function parseOne(entry: unknown) {
  return parseAnnotations(JSON.stringify({ version: ANNOTATION_FORMAT_VERSION, annotations: [entry] }), NOW)
}

describe('serializeAnnotations', () => {
  it('按列表顺序落盘，保证同样的注解总是生成同样的文本', () => {
    const text = serializeAnnotations([bookmark('a', NOW - 2000), highlight('h', NOW - 1000)])

    const parsed = JSON.parse(text) as { version: number; annotations: Annotation[] }
    expect(parsed.version).toBe(ANNOTATION_FORMAT_VERSION)
    expect(parsed.annotations.map((item) => item.id)).toEqual(['h', 'a'])
  })

  it('末尾带换行，方便用文本编辑器直接查看存档', () => {
    expect(serializeAnnotations([]).endsWith('\n')).toBe(true)
  })

  it('只写注解自己的字段，带进来的脏字段不会被打回磁盘', () => {
    const dirty = Object.assign(bookmark('a1', NOW), { 恶意字段: 'x' })

    const parsed = JSON.parse(serializeAnnotations([dirty])) as { annotations: Record<string, unknown>[] }
    expect(JSON.stringify(parsed)).not.toContain('恶意字段')
    expect(Object.keys(parsed.annotations[0]!).sort()).toEqual([
      'bookId',
      'cfi',
      'chapterHref',
      'createdAt',
      'id',
      'kind',
      'note',
      'percent',
      'updatedAt'
    ])
  })

  it('高亮比书签多写摘录与配色，且不写 undefined', () => {
    const parsed = JSON.parse(serializeAnnotations([highlight('h1', NOW)])) as {
      annotations: Record<string, unknown>[]
    }

    expect(parsed.annotations[0]).toMatchObject({ kind: 'highlight', excerpt: '正文片段', color: 'blue' })
    expect(Object.values(parsed.annotations[0]!)).not.toContain(undefined)
  })

  it('同一份内容无论以什么顺序传入，序列化结果逐字节相同', () => {
    const items = [bookmark('a', NOW - 2000), highlight('h', NOW - 1000), bookmark('b', NOW - 3000)]

    expect(serializeAnnotations(items)).toBe(serializeAnnotations([...items].reverse()))
    expect(serializeAnnotations(items)).toBe(serializeAnnotations(items))
  })
})

describe('parseAnnotations', () => {
  it('空文本与纯空白被视为空存档，而不是损坏', () => {
    expect(parseAnnotations('', NOW)).toEqual({ annotations: [], dropped: 0 })
    expect(parseAnnotations('   ', NOW)).toEqual({ annotations: [], dropped: 0 })
    expect(parseAnnotations('\n\t ', NOW)).toEqual({ annotations: [], dropped: 0 })
  })

  it('整份文件不是合法 JSON 时判定为损坏', () => {
    expect(() => parseAnnotations('{ 坏掉的', NOW)).toThrow(AnnotationCorruptError)
    expect(() => parseAnnotations('{ 坏掉的', NOW)).toThrow(/不是合法的 JSON/)
  })

  it('根节点不是对象时判定为损坏', () => {
    expect(() => parseAnnotations('[1,2,3]', NOW)).toThrow(AnnotationCorruptError)
    expect(() => parseAnnotations('null', NOW)).toThrow(AnnotationCorruptError)
    expect(() => parseAnnotations('42', NOW)).toThrow(AnnotationCorruptError)
    expect(() => parseAnnotations('"文本"', NOW)).toThrow(AnnotationCorruptError)
  })

  it('缺失或非法 annotations 字段被视为空存档，而不是损坏', () => {
    expect(parseAnnotations('{}', NOW)).toEqual({ annotations: [], dropped: 0 })
    expect(parseAnnotations('{"annotations":null}', NOW)).toEqual({ annotations: [], dropped: 0 })
    expect(parseAnnotations('{"annotations":7}', NOW)).toEqual({ annotations: [], dropped: 0 })
  })

  it('单条脏数据被丢弃并计数，其余照常读出', () => {
    const good = bookmark('a1', NOW)
    const text = JSON.stringify({
      version: 1,
      annotations: [
        good,
        { ...good, id: 'a1/b' },
        { ...good, bookId: 'b'.repeat(MAX_BOOK_ID_LENGTH + 1) },
        { ...good, id: 'a2', kind: 'note' },
        { ...good, id: 'a3', cfi: '   ' },
        'not-an-object'
      ]
    })

    const parsed = parseAnnotations(text, NOW)
    expect(parsed.annotations).toEqual([good])
    expect(parsed.dropped).toBe(5)
  })

  it('id 非法（含非法字符或超长）的记录被逐条丢弃', () => {
    const good = bookmark('a1', NOW)

    expect(parseOne({ ...good, id: 'a1 b' }).dropped).toBe(1)
    expect(parseOne({ ...good, id: 'a'.repeat(MAX_ANNOTATION_ID_LENGTH + 1) }).dropped).toBe(1)
    expect(parseOne({ ...good, id: 42 }).dropped).toBe(1)
    expect(parseOne(good)).toEqual({ annotations: [good], dropped: 0 })
  })

  it('bookId 非法（空或超长）的记录被逐条丢弃', () => {
    const good = bookmark('a1', NOW)

    expect(parseOne({ ...good, bookId: '  ' }).dropped).toBe(1)
    expect(parseOne({ ...good, bookId: 'b'.repeat(MAX_BOOK_ID_LENGTH + 1) }).dropped).toBe(1)
    expect(parseOne({ ...good, bookId: undefined }).dropped).toBe(1)
  })

  it('kind 非法（缺失或未知枚举值）的记录被丢弃', () => {
    const good = bookmark('a1', NOW)

    expect(parseOne({ ...good, kind: undefined }).dropped).toBe(1)
    expect(parseOne({ ...good, kind: 'BOOKMARK' }).dropped).toBe(1)
    expect(parseOne({ ...good, kind: 1 }).dropped).toBe(1)
  })

  it('cfi 非法（空白或超长）的记录被丢弃，绝不截断成定位不到的 CFI', () => {
    const good = bookmark('a1', NOW)

    expect(parseOne({ ...good, cfi: '   ' }).dropped).toBe(1)
    expect(parseOne({ ...good, cfi: 'a'.repeat(600) }).dropped).toBe(1)
  })

  it('重复的 (bookId, id) 只保留排序后靠前的那条', () => {
    const older = bookmark('a1', NOW - 1000)
    const newer = bookmark('a1', NOW)

    const parsed = parseAnnotations(
      JSON.stringify({ version: 1, annotations: [older, newer] }),
      NOW
    )

    expect(parsed.annotations).toEqual([newer])
    expect(parsed.dropped).toBe(1)
  })

  it('不同书籍里的同名 id 互不影响', () => {
    const parsed = parseAnnotations(
      JSON.stringify({ version: 1, annotations: [bookmark('a1', NOW, 'b1'), bookmark('a1', NOW, 'b2')] }),
      NOW
    )

    expect(parsed.annotations.map((item) => item.bookId)).toEqual(['b1', 'b2'])
    expect(parsed.dropped).toBe(0)
  })

  it('同一本书超过 MAX_ANNOTATIONS_PER_BOOK 的部分被截断并计数', () => {
    const items = Array.from({ length: MAX_ANNOTATIONS_PER_BOOK + 3 }, (_, index) =>
      bookmark(`a${index}`, NOW - index)
    )

    const parsed = parseAnnotations(JSON.stringify({ version: 1, annotations: items }), NOW)

    expect(parsed.annotations).toHaveLength(MAX_ANNOTATIONS_PER_BOOK)
    expect(parsed.annotations[0]?.id).toBe('a0')
    expect(parsed.annotations.at(-1)?.id).toBe(`a${MAX_ANNOTATIONS_PER_BOOK - 1}`)
    expect(parsed.dropped).toBe(3)
  })

  it('每本书的上限各算各的，不会被别的书占满', () => {
    const items = Array.from({ length: MAX_ANNOTATIONS_PER_BOOK + 1 }, (_, index) =>
      bookmark(`a${index}`, NOW - index, 'b1')
    )
    items.push(bookmark('other', NOW, 'b2'))

    const parsed = parseAnnotations(JSON.stringify({ version: 1, annotations: items }), NOW)

    expect(parsed.annotations).toHaveLength(MAX_ANNOTATIONS_PER_BOOK + 1)
    expect(parsed.dropped).toBe(1)
    expect(parsed.annotations.some((item) => item.bookId === 'b2')).toBe(true)
  })

  it('dropped 是三种原因的合并计数，不区分来源', () => {
    const fill = Array.from({ length: MAX_ANNOTATIONS_PER_BOOK }, (_, index) => bookmark(`a${index}`, NOW - index))

    const parsed = parseAnnotations(
      JSON.stringify({
        version: 1,
        annotations: [
          // ① 字段非法：bookId 是空白
          { ...bookmark('bad', NOW), bookId: '  ' },
          ...fill,
          // ② 同一个 id 出现两次，只有一条能留下
          bookmark('dup', NOW - 100),
          bookmark('dup', NOW - 200)
        ]
      }),
      NOW
    )

    expect(parsed.annotations).toHaveLength(MAX_ANNOTATIONS_PER_BOOK)
    expect(parsed.annotations.filter((item) => item.id === 'dup')).toHaveLength(1)
    // 一条坏数据 + 一条重复 + 超限裁掉的一条，三种来源共用一个计数
    expect(parsed.dropped).toBe(3)
  })

  it('输出顺序与输入数组顺序无关', () => {
    const items = [
      bookmark('a', NOW - 2000),
      highlight('c', NOW),
      bookmark('b', NOW - 2000),
      highlight('d', NOW - 5000, 'b2'),
      bookmark('e', NOW - 1000, 'b2'),
      highlight('f', NOW - 2000)
    ]
    const shuffled = [items[3]!, items[0]!, items[5]!, items[2]!, items[4]!, items[1]!]

    const forward = parseAnnotations(JSON.stringify({ version: 1, annotations: items }), NOW)
    const backward = parseAnnotations(JSON.stringify({ version: 1, annotations: shuffled }), NOW)

    expect(forward.dropped).toBe(0)
    expect(forward.annotations).toEqual(backward.annotations)
  })

  it('序列化再解析能完整往返', () => {
    const items = [bookmark('a', NOW - 1000), highlight('h', NOW), bookmark('b', NOW - 3000, 'b2')]

    const parsed = parseAnnotations(serializeAnnotations(items), NOW)

    expect(parsed.annotations).toEqual([...items].sort(compareAnnotationsForList))
    expect(parsed.dropped).toBe(0)
  })
})

describe('isCorruptAnnotationError', () => {
  it('只认自己的错误类型', () => {
    expect(isCorruptAnnotationError(new AnnotationCorruptError('坏'))).toBe(true)
    expect(isCorruptAnnotationError(new Error('坏'))).toBe(false)
    expect(isCorruptAnnotationError(null)).toBe(false)
  })
})
