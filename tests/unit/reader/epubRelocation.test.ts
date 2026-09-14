import { describe, expect, it } from 'vitest'
import { toRelocationInput } from '@renderer/reader/epubRelocation'

describe('toRelocationInput', () => {
  it('把 epub.js 的载荷原样摊平成定位输入', () => {
    expect(
      toRelocationInput(
        {
          start: { index: 3, href: 'chapter4.xhtml', cfi: 'epubcfi(/6/8!/4/2)', displayed: { page: 5, total: 11 } },
          atEnd: false
        },
        12
      )
    ).toEqual({
      cfi: 'epubcfi(/6/8!/4/2)',
      chapterIndex: 3,
      page: 5,
      totalPages: 11,
      spineCount: 12,
      atEnd: false
    })
  })

  it('字段缺失时统一收敛成 null', () => {
    expect(toRelocationInput({}, 7)).toEqual({
      cfi: null,
      chapterIndex: null,
      page: null,
      totalPages: null,
      spineCount: 7,
      atEnd: false
    })
    expect(toRelocationInput({ start: {} }, 7)).toMatchObject({ cfi: null, chapterIndex: null, page: null })
  })

  it('只有布尔 true 才算读到结尾', () => {
    expect(toRelocationInput({ atEnd: true }, 1).atEnd).toBe(true)
    expect(toRelocationInput({ atEnd: undefined }, 1).atEnd).toBe(false)
  })
})
