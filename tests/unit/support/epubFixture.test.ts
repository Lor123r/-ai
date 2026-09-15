import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildEpubBytes, buildZipBytes, FIXTURE_DATE } from '../../support/epubFixture'

/**
 * fixture 是「现场生成」而不是提交二进制，所以生成结果必须完全确定：
 * 只要时间戳跟着当前时间走，同一份 fixture 生成两次就会拿到不同字节，
 * 一切按内容哈希判等的断言都会随机失败（导入去重、重复导入跳过）。
 */
describe('epubFixture 的确定性', () => {
  it('EPUB 里每个 zip 条目都带固定时间戳', async () => {
    const zip = await JSZip.loadAsync(await buildEpubBytes({}))
    const dates = Object.values(zip.files).map((file) => file.date.getTime())

    expect(dates.length).toBeGreaterThan(0)
    expect(new Set(dates)).toEqual(new Set([FIXTURE_DATE.getTime()]))
  })

  it('普通 zip 的条目也被固定住', async () => {
    const zip = await JSZip.loadAsync(await buildZipBytes({ 'a.txt': 'x', 'nested/b.txt': 'y' }))
    const dates = Object.values(zip.files).map((file) => file.date.getTime())

    expect(new Set(dates)).toEqual(new Set([FIXTURE_DATE.getTime()]))
  })

  it('同样的输入生成两次字节完全一致', async () => {
    const first = await buildEpubBytes({ title: '三体' })
    const second = await buildEpubBytes({ title: '三体' })

    expect(first).toEqual(second)
  })
})
