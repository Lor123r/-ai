import { describe, expect, it } from 'vitest'
import { DEFAULT_COVER_MEDIA_TYPE, mediaTypeForCover } from '@core/domain/cover'

describe('mediaTypeForCover', () => {
  it.each([
    ['covers/a.png', 'image/png'],
    ['covers/a.jpg', 'image/jpeg'],
    ['covers/a.JPEG', 'image/jpeg'],
    ['covers/a.gif', 'image/gif'],
    ['covers/a.webp', 'image/webp'],
    ['covers/a.svg', 'image/svg+xml']
  ])('%s → %s', (path, expected) => {
    expect(mediaTypeForCover(path)).toBe(expected)
  })

  it('扩展名认不出来时回落到默认类型', () => {
    expect(mediaTypeForCover('covers/a.tiff')).toBe(DEFAULT_COVER_MEDIA_TYPE)
    expect(mediaTypeForCover('covers/a')).toBe(DEFAULT_COVER_MEDIA_TYPE)
  })
})
