import { describe, expect, it, vi } from 'vitest'
import {
  checkForUpdate,
  parseLatestVersion,
  UPDATE_TIMEOUT_MS,
  type UpdateProbe
} from '../../../src/main/update/updateChecker'

function makeProbe(overrides: Partial<UpdateProbe> = {}): UpdateProbe {
  return {
    isPackaged: true,
    feedUrl: 'https://example.com/latest.yml',
    currentVersion: '0.1.0',
    fetchText: async () => 'version: 0.2.0\npath: ebook-reader-0.2.0-x64.exe\n',
    warn: () => undefined,
    ...overrides
  }
}

describe('parseLatestVersion', () => {
  it('从 electron-builder 的 latest.yml 里抠出版本号', () => {
    const yaml = [
      'version: 0.2.0',
      'files:',
      '  - url: ebook-reader-0.2.0-x64.exe',
      '    sha512: abc',
      'path: ebook-reader-0.2.0-x64.exe',
      'sha512: abc',
      'releaseDate: 2026-01-01T00:00:00.000Z'
    ].join('\n')

    expect(parseLatestVersion(yaml)).toBe('0.2.0')
  })

  it('容忍 CRLF 行尾', () => {
    expect(parseLatestVersion('version: 0.2.0\r\npath: x.exe\r\n')).toBe('0.2.0')
  })

  it('剥掉引号', () => {
    expect(parseLatestVersion('version: "0.2.0"')).toBe('0.2.0')
    expect(parseLatestVersion("version: '0.2.0'")).toBe('0.2.0')
  })

  it('容忍行首行尾空白', () => {
    expect(parseLatestVersion('  version:   0.2.0  ')).toBe('0.2.0')
  })

  it('没有 version 行时返回 null', () => {
    expect(parseLatestVersion('path: x.exe\nsha512: abc')).toBeNull()
  })

  it('version 行是空值时返回 null', () => {
    expect(parseLatestVersion('version:\npath: x.exe')).toBeNull()
    expect(parseLatestVersion('version: ""')).toBeNull()
  })

  it('不把 files 里的 url 误当成版本号', () => {
    // 只认行首的 `version:`，缩进过的 `  - url:` 不该命中
    expect(parseLatestVersion('files:\n  - url: 9.9.9\n')).toBeNull()
  })
})

describe('checkForUpdate', () => {
  it('远端更新时给出 available', async () => {
    await expect(checkForUpdate(makeProbe())).resolves.toEqual({
      status: 'available',
      latestVersion: '0.2.0',
      currentVersion: '0.1.0'
    })
  })

  it('版本相同时给出 up-to-date', async () => {
    const probe = makeProbe({ fetchText: async () => 'version: 0.1.0' })

    await expect(checkForUpdate(probe)).resolves.toEqual({
      status: 'up-to-date',
      currentVersion: '0.1.0'
    })
  })

  it('未打包时不发请求', async () => {
    const fetchText = vi.fn(async () => 'version: 9.9.9')

    await expect(checkForUpdate(makeProbe({ isPackaged: false, fetchText }))).resolves.toEqual({
      status: 'unavailable',
      reason: 'not-packaged'
    })
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('没配更新源时不发请求', async () => {
    const fetchText = vi.fn(async () => 'version: 9.9.9')

    await expect(checkForUpdate(makeProbe({ feedUrl: '', fetchText }))).resolves.toEqual({
      status: 'unavailable',
      reason: 'no-feed'
    })
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('⭐ 网络失败时不抛错，落成 network 并留痕', async () => {
    // 调用方在启动路径上：一次网络异常不该让窗口出不来
    const warn = vi.fn()
    const probe = makeProbe({
      fetchText: async () => {
        throw new Error('ENOTFOUND')
      },
      warn
    })

    await expect(checkForUpdate(probe)).resolves.toEqual({
      status: 'unavailable',
      reason: 'network'
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ENOTFOUND'))
  })

  it('内容里没有版本号时落成 malformed 并留痕', async () => {
    const warn = vi.fn()
    const probe = makeProbe({ fetchText: async () => '<html>404</html>', warn })

    await expect(checkForUpdate(probe)).resolves.toEqual({
      status: 'unavailable',
      reason: 'malformed'
    })
    expect(warn).toHaveBeenCalled()
  })

  it('把超时上限传给取文本函数', async () => {
    // 启动路径上的网络请求必须有上限，否则断网时会挂很久
    const fetchText = vi.fn(async () => 'version: 0.2.0')

    await checkForUpdate(makeProbe({ fetchText }))

    expect(fetchText).toHaveBeenCalledWith('https://example.com/latest.yml', UPDATE_TIMEOUT_MS)
  })
})
