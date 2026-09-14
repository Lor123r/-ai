import { describe, expect, it } from 'vitest'
import { describeImportFailures, describeImportResult } from '@renderer/shelf/importNotice'

describe('describeImportResult', () => {
  it('全成功时只说导入了几本', () => {
    expect(describeImportResult({ added: 3, skipped: 0, failed: [] })).toBe('已导入 3 本')
  })

  it('全部重复时说明跳过了多少本', () => {
    expect(describeImportResult({ added: 0, skipped: 2, failed: [] })).toBe('跳过 2 本重复书籍')
  })

  it('部分失败时把三种结果都写出来', () => {
    const summary = {
      added: 1,
      skipped: 2,
      failed: [{ sourcePath: 'C:/tmp/a.epub', reason: '坏了' }]
    }

    expect(describeImportResult(summary)).toBe('已导入 1 本，跳过 2 本重复书籍，1 个文件未能导入')
  })

  it('什么也没发生时给出兜底文案', () => {
    expect(describeImportResult({ added: 0, skipped: 0, failed: [] })).toBe('没有可导入的文件')
  })
})

describe('describeImportFailures', () => {
  it('没有失败时返回 null', () => {
    expect(describeImportFailures([])).toBeNull()
  })

  it('只显示文件名，多条用分号连接', () => {
    const failures = [
      { sourcePath: 'C:\\Users\\me\\下载\\坏书.epub', reason: '无法解析' },
      { sourcePath: '/home/me/说明书.pdf', reason: '暂不支持该文件格式' }
    ]

    expect(describeImportFailures(failures)).toBe('坏书.epub：无法解析；说明书.pdf：暂不支持该文件格式')
  })

  it('路径里没有分隔符时原样使用', () => {
    expect(describeImportFailures([{ sourcePath: '坏书.epub', reason: '无法解析' }])).toBe('坏书.epub：无法解析')
  })
})
