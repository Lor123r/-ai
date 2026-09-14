import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from '@core/domain/settings'
import { SETTINGS_FILE_NAME, openSettings, resolveSettingsFilePath } from '../../../src/main/storage/settings'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const NOW = 1_700_000_000_000

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ebook-reader-test-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

function settingsPath(): string {
  return join(workDir, SETTINGS_FILE_NAME)
}

function customized(): ReaderSettings {
  return { ...DEFAULT_READER_SETTINGS, fontSize: 24, lineHeight: 2, pageMargin: 48, theme: 'night' }
}

describe('resolveSettingsFilePath', () => {
  it('固定落在数据目录下的 settings.json', () => {
    expect(resolveSettingsFilePath('C:/userData')).toBe(join('C:/userData', SETTINGS_FILE_NAME))
  })
})

describe('openSettings', () => {
  it('首次启动读到默认配置，且不会提前创建文件', async () => {
    const repository = openSettings(settingsPath())

    await expect(repository.load()).resolves.toEqual(DEFAULT_READER_SETTINGS)
    await expect(readdir(workDir)).resolves.toEqual([])
  })

  it('保存的配置在下次启动（新实例）仍然生效', async () => {
    const first = openSettings(settingsPath(), () => NOW)
    await first.save(customized())

    const second = openSettings(settingsPath())
    await expect(second.load()).resolves.toEqual(customized())
  })

  it('落盘时带上写入时间戳，并归一化越界值', async () => {
    const repository = openSettings(settingsPath(), () => NOW)

    await repository.save({ ...DEFAULT_READER_SETTINGS, fontSize: 999, lineHeight: 0.1 })

    const snapshot = JSON.parse(await readFile(settingsPath(), 'utf8')) as {
      version: number
      updatedAt: number
      settings: ReaderSettings
    }
    expect(snapshot.updatedAt).toBe(NOW)
    expect(snapshot.version).toBe(1)
    expect(snapshot.settings.fontSize).toBe(36)
    expect(snapshot.settings.lineHeight).toBe(1.2)
  })

  it('存档损坏时直接回落到默认配置，不备份也不抛错', async () => {
    await writeFile(settingsPath(), '{ 这不是 JSON', 'utf8')

    await expect(openSettings(settingsPath()).load()).resolves.toEqual(DEFAULT_READER_SETTINGS)
    await expect(readdir(workDir)).resolves.toEqual([SETTINGS_FILE_NAME])
  })

  it('存档结构不对（例如是个数组）时同样回落默认配置', async () => {
    await writeFile(settingsPath(), '[1,2,3]', 'utf8')

    await expect(openSettings(settingsPath()).load()).resolves.toEqual(DEFAULT_READER_SETTINGS)
  })

  it('损坏后仍可正常写入新配置', async () => {
    await writeFile(settingsPath(), 'null', 'utf8')

    const repository = openSettings(settingsPath(), () => NOW)
    await repository.save(customized())

    await expect(openSettings(settingsPath()).load()).resolves.toEqual(customized())
  })

  it('磁盘写不进去时错误向上抛出，由调用方决定是否提示', async () => {
    // 用一个同名目录制造 EISDIR，模拟落盘失败
    const blocked = join(workDir, 'blocked')
    await writeFile(blocked, 'x', 'utf8')

    await expect(openSettings(join(blocked, SETTINGS_FILE_NAME)).save(customized())).rejects.toThrow()
  })
})
