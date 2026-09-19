import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkForUpdate,
  defaultUpdateProbe,
  parseFeedUrl,
  parseLatestVersion,
  resolveFeedUrl,
  UPDATE_CONFIG_FILE,
  UPDATE_TIMEOUT_MS,
  type UpdateProbe
} from '../../../src/main/update/updateChecker'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** 造一个假的 `resources/` 目录，里面放一份 `app-update.yml`。 */
function makeResources(content: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'ebook-update-'))
  tempDirs.push(dir)
  if (content !== null) {
    writeFileSync(join(dir, UPDATE_CONFIG_FILE), content, 'utf8')
  }
  return dir
}

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

describe('parseFeedUrl', () => {
  it('从 electron-builder 的 app-update.yml 里抠出地址', () => {
    const yaml = ['provider: generic', 'url: https://example.com/releases', 'updaterCacheDirName: x'].join('\n')

    expect(parseFeedUrl(yaml)).toBe('https://example.com/releases')
  })

  it('容忍 CRLF 行尾与行首行尾空白', () => {
    expect(parseFeedUrl('provider: generic\r\n  url:   https://example.com/r  \r\n')).toBe(
      'https://example.com/r'
    )
  })

  it('剥掉引号', () => {
    expect(parseFeedUrl('url: "https://example.com/r"')).toBe('https://example.com/r')
    expect(parseFeedUrl("url: 'https://example.com/r'")).toBe('https://example.com/r')
  })

  it('没有 url 行时返回空字符串', () => {
    expect(parseFeedUrl('provider: generic')).toBe('')
  })

  it('url 行是空值时返回空字符串', () => {
    expect(parseFeedUrl('url:\nprovider: generic')).toBe('')
    expect(parseFeedUrl('url: ""')).toBe('')
  })

  it('不把 updaterCacheDirName 误当成地址', () => {
    // 只认 `url:` 这个键，别的键里出现 url 字样不该命中
    expect(parseFeedUrl('updaterCacheDirName: url-cache')).toBe('')
  })
})

describe('resolveFeedUrl', () => {
  it('把发布目录拼成 latest.yml 的地址', () => {
    expect(resolveFeedUrl('https://example.com/releases')).toBe(
      'https://example.com/releases/latest.yml'
    )
  })

  it('容忍地址末尾的斜杠', () => {
    // 少写或多写一个 `/` 都不该拼出 `.../releaseslatest.yml` 这种必然 404 的地址
    expect(resolveFeedUrl('https://example.com/releases/')).toBe(
      'https://example.com/releases/latest.yml'
    )
    expect(resolveFeedUrl('https://example.com/releases///')).toBe(
      'https://example.com/releases/latest.yml'
    )
  })

  it('空地址返回空字符串', () => {
    expect(resolveFeedUrl('')).toBe('')
    expect(resolveFeedUrl('   ')).toBe('')
  })
})

describe('defaultUpdateProbe', () => {
  it('从 resources/app-update.yml 读出更新源地址', () => {
    const resources = makeResources('provider: generic\nurl: https://example.com/releases\n')

    const probe = defaultUpdateProbe(true, '0.1.0', resources)

    expect(probe.feedUrl).toBe('https://example.com/releases/latest.yml')
    expect(probe.isPackaged).toBe(true)
    expect(probe.currentVersion).toBe('0.1.0')
  })

  it('读不到 app-update.yml 时更新源为空', () => {
    // 开发态、以及没配 build.publish 的构建都会走到这里，
    // 两者都该是「不检查更新」而不是报错
    const probe = defaultUpdateProbe(true, '0.1.0', makeResources(null))

    expect(probe.feedUrl).toBe('')
  })

  it('app-update.yml 里没有 url 时更新源为空', () => {
    const probe = defaultUpdateProbe(true, '0.1.0', makeResources('provider: generic\n'))

    expect(probe.feedUrl).toBe('')
  })

  it('resources 目录不存在时更新源为空，不抛错', () => {
    const probe = defaultUpdateProbe(true, '0.1.0', join(tmpdir(), 'ebook-update-missing-dir'))

    expect(probe.feedUrl).toBe('')
  })

  it('读不到配置时 checkForUpdate 落成 no-feed 而不是抛错', async () => {
    const probe = defaultUpdateProbe(true, '0.1.0', makeResources(null))

    await expect(checkForUpdate(probe)).resolves.toEqual({
      status: 'unavailable',
      reason: 'no-feed'
    })
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
