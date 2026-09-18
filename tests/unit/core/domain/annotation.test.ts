import { describe, expect, it } from 'vitest'
import {
  compareAnnotationsForList,
  createBookmark,
  createHighlight,
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLORS,
  isAnnotationKind,
  isValidAnnotationId,
  MAX_ANNOTATION_ID_LENGTH,
  MAX_ANNOTATIONS_PER_BOOK,
  MAX_BOOK_ID_LENGTH,
  MAX_CFI_LENGTH,
  MAX_EXCERPT_LENGTH,
  MAX_HREF_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeAnnotationBookId,
  normalizeAnnotationCfi,
  normalizeChapterHref,
  normalizeExcerpt,
  normalizeHighlightColor,
  normalizeNote,
  recolorHighlight,
  reviveAnnotation,
  type Annotation
} from '@core/domain/annotation'

/** 构造一条时间固定的书签，用于排序与列表相关断言。 */
function bookmarkAt(id: string, createdAt: number): Annotation {
  return createBookmark({ id, bookId: 'b1', cfi: 'epubcfi(/6/4!/4/2)' }, createdAt)
}

/** 满足 reviveAnnotation 必填字段的最小对象。 */
function reviveInput(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'a1',
    bookId: 'b1',
    kind: 'bookmark',
    cfi: 'epubcfi(/6/4!/4/2)',
    createdAt: 100,
    updatedAt: 200,
    ...overrides
  }
}

describe('normalizeNote', () => {
  it('非字符串一律回落空串，不返回 null', () => {
    expect(normalizeNote(undefined)).toBe('')
    expect(normalizeNote(null)).toBe('')
    expect(normalizeNote(42)).toBe('')
    expect(normalizeNote({ note: 'x' })).toBe('')
  })

  it('控制字符与换行被压成单个空格', () => {
    expect(normalizeNote('a\nb')).toBe('a b')
    expect(normalizeNote('前\u0000\u0001后')).toBe('前 后')
    expect(normalizeNote('多  个 \t 空白')).toBe('多 个 空白')
  })

  it('首尾空白被 trim，纯空白变为空串', () => {
    expect(normalizeNote('  笔记内容  ')).toBe('笔记内容')
    expect(normalizeNote(' \u0000\n ')).toBe('')
  })

  it('超长笔记截断到正好 2000 字', () => {
    const note = normalizeNote('长'.repeat(MAX_NOTE_LENGTH + 50))
    expect(note).toHaveLength(MAX_NOTE_LENGTH)
    expect(note).toBe('长'.repeat(MAX_NOTE_LENGTH))
  })
})

describe('normalizeExcerpt', () => {
  it('非字符串一律回落空串', () => {
    expect(normalizeExcerpt(undefined)).toBe('')
    expect(normalizeExcerpt(null)).toBe('')
    expect(normalizeExcerpt(7)).toBe('')
  })

  it('按与笔记相同的方式清理正文', () => {
    expect(normalizeExcerpt('  a\nb   c  ')).toBe('a b c')
  })

  it('超长摘录截断到正好 2000 字', () => {
    const excerpt = normalizeExcerpt('字'.repeat(MAX_EXCERPT_LENGTH + 1))
    expect(excerpt).toHaveLength(MAX_EXCERPT_LENGTH)
  })
})

describe('normalizeHighlightColor', () => {
  it('四种合法颜色原样返回', () => {
    expect(HIGHLIGHT_COLORS).toEqual(['yellow', 'green', 'blue', 'pink'])
    for (const color of HIGHLIGHT_COLORS) {
      expect(normalizeHighlightColor(color)).toBe(color)
    }
    expect(DEFAULT_HIGHLIGHT_COLOR).toBe('yellow')
  })

  it('非法颜色回落默认值，大小写不同也算非法', () => {
    expect(normalizeHighlightColor(undefined)).toBe(DEFAULT_HIGHLIGHT_COLOR)
    expect(normalizeHighlightColor(null)).toBe(DEFAULT_HIGHLIGHT_COLOR)
    expect(normalizeHighlightColor('Yellow')).toBe(DEFAULT_HIGHLIGHT_COLOR)
    expect(normalizeHighlightColor(42)).toBe(DEFAULT_HIGHLIGHT_COLOR)
    expect(normalizeHighlightColor({})).toBe(DEFAULT_HIGHLIGHT_COLOR)
    expect(normalizeHighlightColor('')).toBe(DEFAULT_HIGHLIGHT_COLOR)
  })
})

describe('isAnnotationKind', () => {
  it('只认 bookmark 与 highlight', () => {
    expect(isAnnotationKind('bookmark')).toBe(true)
    expect(isAnnotationKind('highlight')).toBe(true)
    expect(isAnnotationKind('BOOKMARK')).toBe(false)
    expect(isAnnotationKind('')).toBe(false)
    expect(isAnnotationKind(null)).toBe(false)
    expect(isAnnotationKind(42)).toBe(false)
    expect(isAnnotationKind({ kind: 'bookmark' })).toBe(false)
  })
})

describe('normalizeAnnotationCfi', () => {
  it('保留合法 CFI 并去掉首尾空白', () => {
    expect(normalizeAnnotationCfi(' epubcfi(/6/4!/4/2) ')).toBe('epubcfi(/6/4!/4/2)')
    expect(normalizeAnnotationCfi('epubcfi(/6/4!/4/2,/1:0,/1:10)')).toBe('epubcfi(/6/4!/4/2,/1:0,/1:10)')
  })

  it('空白串与非字符串回落到 null', () => {
    expect(normalizeAnnotationCfi('   ')).toBeNull()
    expect(normalizeAnnotationCfi('')).toBeNull()
    expect(normalizeAnnotationCfi(42)).toBeNull()
    expect(normalizeAnnotationCfi(null)).toBeNull()
    expect(normalizeAnnotationCfi(undefined)).toBeNull()
  })

  it('超长 CFI 整条拒绝，绝不截断成 512 字符', () => {
    const tooLong = 'a'.repeat(MAX_CFI_LENGTH + 1)
    const normalized = normalizeAnnotationCfi(tooLong)

    expect(normalizeAnnotationCfi('a'.repeat(MAX_CFI_LENGTH))).toHaveLength(MAX_CFI_LENGTH)
    // 截断出来的 CFI 语法无效，比整条拒绝更糟
    expect(normalized).not.toBe(tooLong.slice(0, MAX_CFI_LENGTH))
    expect(normalized).toBeNull()
  })
})

describe('normalizeChapterHref', () => {
  it('相对 href 原样保留，含 fragment 与上级目录', () => {
    expect(normalizeChapterHref('ch1.xhtml')).toBe('ch1.xhtml')
    expect(normalizeChapterHref(' text/ch1.xhtml#sec1 ')).toBe('text/ch1.xhtml#sec1')
    expect(normalizeChapterHref('../img/a.png')).toBe('../img/a.png')
    expect(normalizeChapterHref('#sec1')).toBe('#sec1')
  })

  it('带 scheme 的绝对 URL 一律丢弃', () => {
    expect(normalizeChapterHref('javascript:alert(1)')).toBe('')
    expect(normalizeChapterHref('JAVASCRIPT:alert(1)')).toBe('')
    expect(normalizeChapterHref('data:text/html,x')).toBe('')
    expect(normalizeChapterHref('http://evil.test/a')).toBe('')
    expect(normalizeChapterHref('mailto:a@b.c')).toBe('')
  })

  it('去掉控制字符后再判定 scheme，绕过不了拦截', () => {
    expect(normalizeChapterHref('java\u0000script:alert(1)')).toBe('')
    expect(normalizeChapterHref('ch1\u0000.xhtml')).toBe('ch1.xhtml')
  })

  it('空值、非字符串与超长 href 回落空串', () => {
    expect(normalizeChapterHref(undefined)).toBe('')
    expect(normalizeChapterHref(null)).toBe('')
    expect(normalizeChapterHref(42)).toBe('')
    expect(normalizeChapterHref({})).toBe('')
    expect(normalizeChapterHref('   ')).toBe('')
    expect(normalizeChapterHref('a'.repeat(MAX_HREF_LENGTH))).toHaveLength(MAX_HREF_LENGTH)
    expect(normalizeChapterHref('a'.repeat(MAX_HREF_LENGTH + 1))).toBe('')
  })
})

describe('createBookmark', () => {
  it('规范化各字段并记录同一时刻的创建与更新时间', () => {
    const bookmark = createBookmark(
      {
        id: ' a1 ',
        bookId: ' b1 ',
        cfi: ' epubcfi(/6/4!/4/2) ',
        chapterHref: ' text/ch1.xhtml#s1 ',
        percent: 0.42,
        note: ' 这是一条\u0000笔记 '
      },
      1000
    )

    expect(bookmark).toEqual({
      id: 'a1',
      bookId: 'b1',
      kind: 'bookmark',
      cfi: 'epubcfi(/6/4!/4/2)',
      chapterHref: 'text/ch1.xhtml#s1',
      percent: 0.42,
      note: '这是一条 笔记',
      createdAt: 1000,
      updatedAt: 1000
    })
  })

  it('可选字段缺省时给出安全默认值', () => {
    const bookmark = createBookmark({ id: 'a1', bookId: 'b1', cfi: 'epubcfi(/6/4)' }, 7)

    expect(bookmark.chapterHref).toBe('')
    expect(bookmark.percent).toBe(0)
    expect(bookmark.note).toBe('')
    expect(bookmark.createdAt).toBe(7)
    expect(bookmark.updatedAt).toBe(7)
  })

  it('越界进度被夹到 0 ~ 1，非法 href 被丢弃', () => {
    const base = { id: 'a1', bookId: 'b1', cfi: 'epubcfi(/6/4)' }

    expect(createBookmark({ ...base, percent: 9 }, 1).percent).toBe(1)
    expect(createBookmark({ ...base, percent: -1 }, 1).percent).toBe(0)
    expect(createBookmark({ ...base, percent: Number.NaN }, 1).percent).toBe(0)
    expect(createBookmark({ ...base, chapterHref: 'javascript:alert(1)' }, 1).chapterHref).toBe('')
  })

  it('缺少必填字段时抛错，不产生定位不到的注解', () => {
    expect(() => createBookmark({ id: '  ', bookId: 'b1', cfi: 'epubcfi(/6/4)' })).toThrow(/^注解 id 不能为空$/)
    expect(() => createBookmark({ id: 'a1', bookId: ' \t ', cfi: 'epubcfi(/6/4)' })).toThrow(
      /^注解所属书籍 id 不能为空$/
    )
    expect(() => createBookmark({ id: 'a1', bookId: 'b1', cfi: '   ' })).toThrow(/^注解定位不能为空$/)
    expect(() => createBookmark({ id: 'a1', bookId: 'b1', cfi: undefined as unknown as string })).toThrow(
      /^注解定位不能为空$/
    )
  })

  it('CFI 超长时抛错而不是截断', () => {
    expect(() => createBookmark({ id: 'a1', bookId: 'b1', cfi: 'a'.repeat(MAX_CFI_LENGTH + 1) })).toThrow(
      /^注解定位过长$/
    )
  })
})

describe('createHighlight', () => {
  it('规范化各字段并带上摘录与颜色', () => {
    const highlight = createHighlight(
      {
        id: 'h1',
        bookId: 'b1',
        cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
        chapterHref: 'ch1.xhtml',
        percent: 0.5,
        note: '重点',
        excerpt: ' 正文\n片段 ',
        color: 'green'
      },
      2000
    )

    expect(highlight).toEqual({
      id: 'h1',
      bookId: 'b1',
      kind: 'highlight',
      cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
      chapterHref: 'ch1.xhtml',
      percent: 0.5,
      note: '重点',
      excerpt: '正文 片段',
      color: 'green',
      createdAt: 2000,
      updatedAt: 2000
    })
  })

  it('摘录与颜色缺省时回落空串与默认黄色', () => {
    const highlight = createHighlight({ id: 'h1', bookId: 'b1', cfi: 'epubcfi(/6/4)' }, 9)

    expect(highlight.excerpt).toBe('')
    expect(highlight.color).toBe(DEFAULT_HIGHLIGHT_COLOR)
    expect(highlight.createdAt).toBe(9)
  })

  it('非法颜色被收敛为默认色', () => {
    const highlight = createHighlight(
      { id: 'h1', bookId: 'b1', cfi: 'epubcfi(/6/4)', color: 'Yellow' as never },
      1
    )
    expect(highlight.color).toBe(DEFAULT_HIGHLIGHT_COLOR)
  })

  it('三条必填校验与书签一致', () => {
    expect(() => createHighlight({ id: ' ', bookId: 'b1', cfi: 'epubcfi(/6/4)' })).toThrow(/^注解 id 不能为空$/)
    expect(() => createHighlight({ id: 'h1', bookId: ' ', cfi: 'epubcfi(/6/4)' })).toThrow(
      /^注解所属书籍 id 不能为空$/
    )
    expect(() => createHighlight({ id: 'h1', bookId: 'b1', cfi: '  ' })).toThrow(/^注解定位不能为空$/)
  })

  it('CFI 超长时抛错，明确不截断成 512 字符', () => {
    const tooLong = 'a'.repeat(MAX_CFI_LENGTH + 1)

    expect(() => createHighlight({ id: 'h1', bookId: 'b1', cfi: tooLong })).toThrow(/^注解定位过长$/)
    expect(normalizeAnnotationCfi(tooLong)).not.toBe(tooLong.slice(0, MAX_CFI_LENGTH))
    expect(normalizeAnnotationCfi(tooLong)).toBeNull()
  })
})

describe('recolorHighlight', () => {
  /** 时间固定的划线：用来证明改色只动 color 与 updatedAt。 */
  const ORIGINAL = createHighlight(
    {
      id: 'h1',
      bookId: 'b1',
      cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
      chapterHref: 'ch1.xhtml',
      percent: 0.4,
      note: '重点',
      excerpt: '正文片段',
      color: 'yellow'
    },
    1000
  )

  it('只换配色并推进 updatedAt，id / cfi / excerpt / createdAt 一个不动', () => {
    expect(recolorHighlight(ORIGINAL, 'blue', 5000)).toEqual({
      id: 'h1',
      bookId: 'b1',
      kind: 'highlight',
      cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
      chapterHref: 'ch1.xhtml',
      percent: 0.4,
      note: '重点',
      excerpt: '正文片段',
      color: 'blue',
      createdAt: 1000,
      updatedAt: 5000
    })
  })

  it('非法配色收敛成默认色，不把未知字符串写进存档', () => {
    expect(recolorHighlight(ORIGINAL, 'Purple' as never, 5).color).toBe(DEFAULT_HIGHLIGHT_COLOR)
  })

  it('返回的是新对象，原来那条还是旧颜色与旧修改时间', () => {
    const next = recolorHighlight(ORIGINAL, 'pink', 5)

    expect(next).not.toBe(ORIGINAL)
    expect(ORIGINAL.color).toBe('yellow')
    expect(ORIGINAL.updatedAt).toBe(1000)
  })
})

describe('reviveAnnotation', () => {
  it('完整合法的高亮对象被原样还原', () => {
    const stored = {
      id: 'h1',
      bookId: 'b1',
      kind: 'highlight',
      cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
      chapterHref: 'text/ch1.xhtml#s1',
      percent: 0.35,
      note: '笔记',
      excerpt: '片段',
      color: 'blue',
      createdAt: 111,
      updatedAt: 222
    }

    expect(reviveAnnotation(stored, 999)).toEqual(stored)
  })

  it('书签分支不会带上高亮专属字段', () => {
    const revived = reviveAnnotation({ ...reviveInput({}), excerpt: '片段', color: 'blue' }, 1)

    expect(revived).toEqual({
      id: 'a1',
      bookId: 'b1',
      kind: 'bookmark',
      cfi: 'epubcfi(/6/4!/4/2)',
      chapterHref: '',
      percent: 0,
      note: '',
      createdAt: 100,
      updatedAt: 200
    })
    expect(Object.keys(revived ?? {}).sort()).toEqual([
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

  it('非对象一律返回 null', () => {
    expect(reviveAnnotation(null)).toBeNull()
    expect(reviveAnnotation(undefined)).toBeNull()
    expect(reviveAnnotation('bookmark')).toBeNull()
    expect(reviveAnnotation(7)).toBeNull()
    expect(reviveAnnotation([])).toBeNull()
  })

  it('关键字段非法时丢弃该条，而不是让整个列表读不出来', () => {
    expect(reviveAnnotation(reviveInput({ id: undefined }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ id: '   ' }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ id: 42 }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ bookId: undefined }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ bookId: '  ' }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ kind: 'note' }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ kind: undefined }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ kind: 1 }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ cfi: '   ' }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ cfi: 42 }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ cfi: 'a'.repeat(MAX_CFI_LENGTH + 1) }))).toBeNull()
  })

  it('缺 createdAt 时用注入的 now，缺 updatedAt 时等于 createdAt', () => {
    const revived = reviveAnnotation(reviveInput({ createdAt: undefined, updatedAt: undefined }), 777)

    expect(revived?.createdAt).toBe(777)
    expect(revived?.updatedAt).toBe(777)
  })

  it('updatedAt 非法时回落到 createdAt 而不是 now', () => {
    const revived = reviveAnnotation(reviveInput({ createdAt: 500, updatedAt: -1 }), 999)

    expect(revived?.createdAt).toBe(500)
    expect(revived?.updatedAt).toBe(500)
  })

  it('时间戳取整，非法时间戳回落 now', () => {
    expect(reviveAnnotation(reviveInput({ createdAt: 100.6, updatedAt: 200.4 }), 1)).toMatchObject({
      createdAt: 101,
      updatedAt: 200
    })

    const broken = reviveInput({ createdAt: Number.NaN, updatedAt: Number.POSITIVE_INFINITY })
    expect(reviveAnnotation(broken, 33)).toMatchObject({ createdAt: 33, updatedAt: 33 })
  })

  it('percent 越界被夹紧，href 与文本走规范化', () => {
    const revived = reviveAnnotation(
      reviveInput({
        kind: 'highlight',
        percent: 9,
        chapterHref: 'javascript:alert(1)',
        note: ' a\nb ',
        excerpt: ' c\nd ',
        color: 'neon'
      }),
      1
    )

    expect(revived).toMatchObject({
      percent: 1,
      chapterHref: '',
      note: 'a b',
      excerpt: 'c d',
      color: DEFAULT_HIGHLIGHT_COLOR
    })
    expect(reviveAnnotation(reviveInput({ percent: -3 }), 1)?.percent).toBe(0)
    expect(reviveAnnotation(reviveInput({ percent: 'half' }), 1)?.percent).toBe(0)
  })

  it('去掉多余字段，落盘不会带上脏数据', () => {
    const revived = reviveAnnotation(reviveInput({ 恶意字段: 'x' }), 1)

    expect(Object.keys(revived ?? {})).not.toContain('恶意字段')
  })
})

describe('compareAnnotationsForList', () => {
  it('新建的注解排在前面', () => {
    const older = bookmarkAt('a', 100)
    const newer = bookmarkAt('b', 300)
    const middle = bookmarkAt('c', 200)

    expect([older, newer, middle].sort(compareAnnotationsForList).map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('创建时间相同时按 id 升序兜底', () => {
    const a = bookmarkAt('a', 100)
    const b = bookmarkAt('b', 100)

    expect([b, a].sort(compareAnnotationsForList).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('排序结果与输入顺序无关', () => {
    const items = [bookmarkAt('b', 100), bookmarkAt('c', 300), bookmarkAt('a', 100)]
    const forward = [...items].sort(compareAnnotationsForList).map((item) => item.id)
    const backward = [...items].reverse().sort(compareAnnotationsForList).map((item) => item.id)

    expect(forward).toEqual(['c', 'a', 'b'])
    expect(backward).toEqual(forward)
  })
})

describe('判别联合', () => {
  function label(annotation: Annotation): string {
    if (annotation.kind === 'highlight') {
      return `${annotation.color}:${annotation.excerpt}`
    }
    return `bookmark:${annotation.cfi}`
  }

  it('按 kind 收窄后能访问各自专属字段', () => {
    const highlight = createHighlight(
      { id: 'h1', bookId: 'b1', cfi: 'epubcfi(/6/4)', excerpt: '片段', color: 'pink' },
      1
    )
    const bookmark = createBookmark({ id: 'a1', bookId: 'b1', cfi: 'epubcfi(/6/4)' }, 2)

    expect(label(highlight)).toBe('pink:片段')
    expect(label(bookmark)).toBe('bookmark:epubcfi(/6/4)')
  })
})

describe('isValidAnnotationId', () => {
  it('字母、数字、下划线与连字符都合法', () => {
    expect(isValidAnnotationId('a1')).toBe(true)
    expect(isValidAnnotationId('H_1-b')).toBe(true)
    expect(isValidAnnotationId('3f2b8c1e-9d4a-4b7c-8e5f-0a1b2c3d4e5f')).toBe(true)
    expect(isValidAnnotationId('a'.repeat(MAX_ANNOTATION_ID_LENGTH))).toBe(true)
  })

  it('首尾空白先 trim 再判定，因为落盘用的也是 trim 后的值', () => {
    expect(isValidAnnotationId(' a1 ')).toBe(true)
  })

  it('空串、纯空白与非字符串一律非法', () => {
    expect(isValidAnnotationId('')).toBe(false)
    expect(isValidAnnotationId('   ')).toBe(false)
    expect(isValidAnnotationId(null)).toBe(false)
    expect(isValidAnnotationId(undefined)).toBe(false)
    expect(isValidAnnotationId(42)).toBe(false)
    expect(isValidAnnotationId({ id: 'a1' })).toBe(false)
    expect(isValidAnnotationId(['a1'])).toBe(false)
  })

  it('超长 id 非法', () => {
    expect(isValidAnnotationId('a'.repeat(MAX_ANNOTATION_ID_LENGTH + 1))).toBe(false)
  })

  it('空白、中文、路径分隔符与引号一律非法', () => {
    expect(isValidAnnotationId('a b')).toBe(false)
    expect(isValidAnnotationId('注解')).toBe(false)
    expect(isValidAnnotationId('a/b')).toBe(false)
    expect(isValidAnnotationId('a\\b')).toBe(false)
    expect(isValidAnnotationId('..')).toBe(false)
    expect(isValidAnnotationId('../a')).toBe(false)
    expect(isValidAnnotationId('a"b')).toBe(false)
  })

  it('__proto__ 这类名字符合字符集，内部用 Map 存所以不存在原型污染', () => {
    expect(isValidAnnotationId('__proto__')).toBe(true)
    expect(isValidAnnotationId('constructor')).toBe(true)
  })
})

describe('normalizeAnnotationBookId', () => {
  it('trim 后非空且不超长才接受', () => {
    expect(normalizeAnnotationBookId(' b1 ')).toBe('b1')
    expect(normalizeAnnotationBookId('b'.repeat(MAX_BOOK_ID_LENGTH))).toHaveLength(MAX_BOOK_ID_LENGTH)
  })

  it('空值、纯空白、非字符串与超长一律返回 null', () => {
    expect(normalizeAnnotationBookId('')).toBeNull()
    expect(normalizeAnnotationBookId('  ')).toBeNull()
    expect(normalizeAnnotationBookId(null)).toBeNull()
    expect(normalizeAnnotationBookId(42)).toBeNull()
    expect(normalizeAnnotationBookId('b'.repeat(MAX_BOOK_ID_LENGTH + 1))).toBeNull()
  })
})

describe('注解 id 的长度与字符集上限', () => {
  it('createBookmark / createHighlight 超长 id 抛错，正好等于上限仍然合法', () => {
    const tooLong = 'a'.repeat(MAX_ANNOTATION_ID_LENGTH + 1)

    expect(() => createBookmark({ id: tooLong, bookId: 'b1', cfi: 'epubcfi(/6/4)' })).toThrow(/^注解 id 过长$/)
    expect(() => createHighlight({ id: tooLong, bookId: 'b1', cfi: 'epubcfi(/6/4)' })).toThrow(/^注解 id 过长$/)
    expect(
      createBookmark({ id: 'a'.repeat(MAX_ANNOTATION_ID_LENGTH), bookId: 'b1', cfi: 'epubcfi(/6/4)' }).id
    ).toHaveLength(MAX_ANNOTATION_ID_LENGTH)
  })

  it('createBookmark / createHighlight 非法字符抛错', () => {
    for (const id of ['a b', 'a/b', 'a\\b', '注解', 'a"b']) {
      expect(() => createBookmark({ id, bookId: 'b1', cfi: 'epubcfi(/6/4)' })).toThrow(/^注解 id 含非法字符$/)
      expect(() => createHighlight({ id, bookId: 'b1', cfi: 'epubcfi(/6/4)' })).toThrow(/^注解 id 含非法字符$/)
    }
  })

  it('bookId 超长时抛错', () => {
    const tooLong = 'b'.repeat(MAX_BOOK_ID_LENGTH + 1)

    expect(() => createBookmark({ id: 'a1', bookId: tooLong, cfi: 'epubcfi(/6/4)' })).toThrow(
      /^注解所属书籍 id 过长$/
    )
    expect(() => createHighlight({ id: 'h1', bookId: tooLong, cfi: 'epubcfi(/6/4)' })).toThrow(
      /^注解所属书籍 id 过长$/
    )
  })

  it('reviveAnnotation 对非法 id / bookId 返回 null，而不是截断成合法值', () => {
    expect(reviveAnnotation(reviveInput({ id: 'a b' }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ id: 'a'.repeat(MAX_ANNOTATION_ID_LENGTH + 1) }))).toBeNull()
    expect(reviveAnnotation(reviveInput({ bookId: 'b'.repeat(MAX_BOOK_ID_LENGTH + 1) }))).toBeNull()
    // 字符集里的怪名字照样能原样读回来
    expect(reviveAnnotation(reviveInput({ id: '__proto__' }))?.id).toBe('__proto__')
  })

  it('MAX_ANNOTATIONS_PER_BOOK 是正整数', () => {
    expect(Number.isInteger(MAX_ANNOTATIONS_PER_BOOK)).toBe(true)
    expect(MAX_ANNOTATIONS_PER_BOOK).toBeGreaterThan(0)
  })
})
