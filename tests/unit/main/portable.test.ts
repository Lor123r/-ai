import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PORTABLE_DATA_DIR,
  PORTABLE_MARKER,
  applyUserDataOverride,
  resolvePortableDataDir,
  resolveUserDataOverride,
  type PortableProbe
} from '../../../src/main/storage/portable'

const EXEC_DIR = 'C:\\apps\\ebook-reader'
const EXEC_PATH = join(EXEC_DIR, 'ebook-reader.exe')

interface ProbeOptions {
  isPackaged?: boolean
  execPath?: string
  /** 标记文件是否存在且是文件。 */
  marker?: boolean
  /** makeDir 是否抛错。 */
  makeDirFails?: boolean
}

function makeProbe(options: ProbeOptions = {}): PortableProbe & { warnings: string[]; made: string[] } {
  const warnings: string[] = []
  const made: string[] = []

  return {
    isPackaged: options.isPackaged ?? true,
    execPath: options.execPath ?? EXEC_PATH,
    isFile: () => options.marker ?? true,
    makeDir: (path) => {
      if (options.makeDirFails) throw new Error('EACCES: permission denied')
      made.push(path)
    },
    warn: (message) => warnings.push(message),
    warnings,
    made
  }
}

describe('resolvePortableDataDir', () => {
  it('未打包时一律不启用便携模式', () => {
    const probe = makeProbe({ isPackaged: false })

    expect(resolvePortableDataDir(probe)).toBeNull()
    expect(probe.made).toEqual([])
  })

  it('打包但没有标记文件时不启用', () => {
    const probe = makeProbe({ marker: false })

    expect(resolvePortableDataDir(probe)).toBeNull()
    expect(probe.made).toEqual([])
  })

  it('打包且有标记文件时用 exe 同级的 data 目录', () => {
    const probe = makeProbe()

    expect(resolvePortableDataDir(probe)).toBe(join(EXEC_DIR, PORTABLE_DATA_DIR))
    expect(probe.made).toEqual([join(EXEC_DIR, PORTABLE_DATA_DIR)])
  })

  it('数据目录不直接用 exe 同级目录', () => {
    const probe = makeProbe()

    expect(resolvePortableDataDir(probe)).not.toBe(EXEC_DIR)
  })

  it('建目录失败时回落 null 并留痕，不抛错', () => {
    const probe = makeProbe({ makeDirFails: true })

    expect(() => resolvePortableDataDir(probe)).not.toThrow()
    expect(resolvePortableDataDir(probe)).toBeNull()
    expect(probe.warnings).toHaveLength(2)
    expect(probe.warnings[0]).toContain('便携数据目录建不出来')
  })

  it('留痕里带上目标目录，用户才知道数据没写进去', () => {
    const probe = makeProbe({ makeDirFails: true })

    resolvePortableDataDir(probe)

    expect(probe.warnings[0]).toContain(join(EXEC_DIR, PORTABLE_DATA_DIR))
  })

  it('拿不到 exe 所在目录时回落 null 并留痕', () => {
    const probe = makeProbe({ execPath: 'ebook-reader.exe' })

    expect(resolvePortableDataDir(probe)).toBeNull()
    expect(probe.warnings[0]).toContain('拿不到可执行文件所在目录')
  })

  it('标记文件是目录时不算数', () => {
    // isFile 返回 false 就是「存在但不是文件」，existsSync 在这里会误判成 true
    const probe = makeProbe({ marker: false })

    expect(resolvePortableDataDir(probe)).toBeNull()
  })

  it('标记文件名与数据目录名是稳定的对外约定', () => {
    expect(PORTABLE_MARKER).toBe('portable.txt')
    expect(PORTABLE_DATA_DIR).toBe('data')
  })
})

describe('resolveUserDataOverride', () => {
  it('环境变量优先于便携模式', () => {
    const probe = makeProbe()

    expect(resolveUserDataOverride('D:\\tmp\\e2e', probe)).toEqual({
      dir: 'D:\\tmp\\e2e',
      source: 'env'
    })
    expect(probe.made).toEqual([])
  })

  it('没有环境变量时用便携目录', () => {
    const probe = makeProbe()

    expect(resolveUserDataOverride(undefined, probe)).toEqual({
      dir: join(EXEC_DIR, PORTABLE_DATA_DIR),
      source: 'portable'
    })
  })

  it('两者都没有时沿用默认目录', () => {
    const probe = makeProbe({ marker: false })

    expect(resolveUserDataOverride(undefined, probe)).toEqual({ dir: null, source: 'default' })
  })

  it('空字符串环境变量不算覆盖', () => {
    const probe = makeProbe({ marker: false })

    expect(resolveUserDataOverride('', probe).source).toBe('default')
  })
})

describe('applyUserDataOverride', () => {
  it('算出目录时调用 setPath', () => {
    const calls: string[] = []

    const result = applyUserDataOverride(
      'D:\\tmp\\e2e',
      true,
      (dir) => calls.push(dir),
      makeProbe()
    )

    expect(calls).toEqual(['D:\\tmp\\e2e'])
    expect(result.source).toBe('env')
  })

  it('算不出目录时不调用 setPath', () => {
    const calls: string[] = []

    applyUserDataOverride(undefined, true, (dir) => calls.push(dir), makeProbe({ marker: false }))

    expect(calls).toEqual([])
  })

  it('未打包时不调用 setPath，即使标记文件在', () => {
    const calls: string[] = []

    const result = applyUserDataOverride(
      undefined,
      false,
      (dir) => calls.push(dir),
      makeProbe({ isPackaged: false })
    )

    expect(calls).toEqual([])
    expect(result.source).toBe('default')
  })

  it('isPackaged 是必填参数，探针不会自己猜', () => {
    // 这条钉的是一个真实踩过的坑：探针里曾经写死 isPackaged: false，
    // 于是单测全绿、真机永远走默认目录。现在漏传会直接编译报错。
    expect(applyUserDataOverride.length).toBeGreaterThanOrEqual(3)
  })
})
