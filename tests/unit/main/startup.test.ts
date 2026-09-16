import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCorruptLibraryError } from '@core/adapters/librarySnapshot'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { createBookmark } from '@core/domain/annotation'
import { createBook } from '@core/domain/book'
import { ANNOTATIONS_FILE_NAME } from '../../../src/main/storage/annotations'
import { LIBRARY_FILE_NAME, openLibrary } from '../../../src/main/storage/library'
import { openStorageForStartup } from '../../../src/main/storage/startup'
import {
  ANNOTATIONS_UNAVAILABLE_MESSAGE,
  UnavailableAnnotationRepository
} from '../../../src/main/storage/unavailableAnnotationRepository'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const NOW = 1_700_000_000_000
const BROKEN_TEXT = '{ 这不是 JSON'

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ebook-reader-startup-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

function annotationsPath(): string {
  return join(workDir, ANNOTATIONS_FILE_NAME)
}

function libraryPath(): string {
  return join(workDir, LIBRARY_FILE_NAME)
}

/** addedAt 用固定值：createBook 默认取 Date.now()，每次调用都会得到不同的书。 */
function sampleBook(id = 'b1') {
  return {
    ...createBook({
      id,
      title: '样例书籍',
      author: '佚名',
      format: 'epub',
      filePath: `C:/lib/${id}.epub`,
      fileSize: 1024
    }),
    addedAt: NOW
  }
}

function sampleAnnotation() {
  return createBookmark({ id: 'a1', bookId: 'b1', cfi: 'epubcfi(/6/4!/4/2/2)', note: '笔记' }, NOW)
}

describe('openStorageForStartup', () => {
  it('干净启动时没有警告，两个存档都能正常落盘', async () => {
    const boot = await openStorageForStartup(workDir, () => NOW)

    expect(boot.warnings).toEqual([])

    await boot.library.save(sampleBook())
    await boot.annotations.save(sampleAnnotation())

    const libraryText = await readFile(libraryPath(), 'utf8')
    const annotationsText = await readFile(annotationsPath(), 'utf8')
    expect(libraryText).toContain('b1')
    expect(annotationsText).toContain('a1')
  })

  it('上次写入的数据能在下次启动时读回', async () => {
    const first = await openStorageForStartup(workDir, () => NOW)
    await first.library.save(sampleBook())
    await first.annotations.save(sampleAnnotation())

    const second = await openStorageForStartup(workDir, () => NOW)
    await expect(second.library.get('b1')).resolves.toEqual(sampleBook())
    await expect(second.annotations.listByBook('b1')).resolves.toEqual([sampleAnnotation()])
    expect(second.warnings).toEqual([])
  })

  it('书库存档损坏时备份原文件并留下警告', async () => {
    await writeFile(libraryPath(), BROKEN_TEXT, 'utf8')

    const boot = await openStorageForStartup(workDir, () => NOW)

    await expect(boot.library.list()).resolves.toEqual([])
    expect(boot.warnings).toHaveLength(1)
    expect(boot.warnings[0]).toContain('书库存档无法读取')
    await expect(readdir(workDir)).resolves.toContain(`${LIBRARY_FILE_NAME}.corrupt-${NOW}`)
  })

  it('注解存档损坏时备份原文件并留下警告，书库不受牵连', async () => {
    await writeFile(libraryPath(), JSON.stringify({ version: 1, books: [sampleBook()], locators: {} }), 'utf8')
    await writeFile(annotationsPath(), BROKEN_TEXT, 'utf8')

    const boot = await openStorageForStartup(workDir, () => NOW)

    await expect(boot.annotations.listByBook('b1')).resolves.toEqual([])
    await expect(boot.library.get('b1')).resolves.toEqual(sampleBook())
    expect(boot.warnings).toHaveLength(1)
    expect(boot.warnings[0]).toContain('注解存档无法读取')
    await expect(readdir(workDir)).resolves.toContain(`${ANNOTATIONS_FILE_NAME}.corrupt-${NOW}`)
  })

  it('两个存档同时损坏时两条警告都在，仍然正常返回', async () => {
    await writeFile(libraryPath(), BROKEN_TEXT, 'utf8')
    await writeFile(annotationsPath(), BROKEN_TEXT, 'utf8')

    const boot = await openStorageForStartup(workDir, () => NOW)

    expect(boot.warnings).toHaveLength(2)
    expect(boot.warnings.join('\n')).toContain('书库存档无法读取')
    expect(boot.warnings.join('\n')).toContain('注解存档无法读取')
  })

  it('注解存档打不开时降级为「写入即失败」，磁盘上的文件一个字节都不动', async () => {
    // 目录占住 annotations.json：readFile 抛 EISDIR，parse 根本没机会跑，
    // 所以这是「打不开」而不是「损坏」，不会走备份，也不能走 Json 仓储
    await mkdir(annotationsPath())
    await writeFile(join(annotationsPath(), 'inside.txt'), '原有内容', 'utf8')

    const boot = await openStorageForStartup(workDir, () => NOW)

    expect(boot.warnings).toHaveLength(1)
    expect(boot.warnings[0]).toContain('注解存档无法打开')

    // 降级后本次会话的注解功能整体不可用：读不到也写不进。内存实现会在这里 resolve
    // 并在内存里留下副本，界面于是显示「已保存」而磁盘空白 —— 用户关掉应用才发现全丢
    expect(boot.annotations).toBeInstanceOf(UnavailableAnnotationRepository)
    await expect(boot.annotations.save(sampleAnnotation())).rejects.toThrow(ANNOTATIONS_UNAVAILABLE_MESSAGE)
    await expect(boot.annotations.listByBook('b1')).rejects.toThrow(ANNOTATIONS_UNAVAILABLE_MESSAGE)
    await expect(boot.annotations.remove('b1', 'a1')).rejects.toThrow(ANNOTATIONS_UNAVAILABLE_MESSAGE)
    await expect(boot.annotations.removeByBook('b1')).rejects.toThrow(ANNOTATIONS_UNAVAILABLE_MESSAGE)
    // load() 是唯一保持 resolve 的方法：它不该给启动链引入新的 rejection
    await expect(boot.annotations.load()).resolves.toBeUndefined()

    await expect(readFile(join(annotationsPath(), 'inside.txt'), 'utf8')).resolves.toBe('原有内容')
    await expect(readdir(workDir)).resolves.toEqual([ANNOTATIONS_FILE_NAME])
  })

  it('书库读不出不影响注解落盘', async () => {
    await mkdir(libraryPath())
    await writeFile(join(libraryPath(), 'inside.txt'), '原有内容', 'utf8')

    const boot = await openStorageForStartup(workDir, () => NOW)

    expect(boot.warnings).toHaveLength(1)
    expect(boot.warnings[0]).toContain('书库无法打开')
    await boot.annotations.save(sampleAnnotation())
    await expect(readFile(annotationsPath(), 'utf8')).resolves.toContain('a1')
    await expect(readFile(join(libraryPath(), 'inside.txt'), 'utf8')).resolves.toBe('原有内容')
  })

  it('注解读不出不影响书库落盘', async () => {
    await mkdir(annotationsPath())
    await writeFile(join(annotationsPath(), 'inside.txt'), '原有内容', 'utf8')

    const boot = await openStorageForStartup(workDir, () => NOW)

    expect(boot.warnings).toHaveLength(1)
    expect(boot.warnings[0]).toContain('注解存档无法打开')
    await boot.library.save(sampleBook())
    await expect(readFile(libraryPath(), 'utf8')).resolves.toContain('b1')
    await expect(readFile(join(annotationsPath(), 'inside.txt'), 'utf8')).resolves.toBe('原有内容')
  })

  it('书库备份失败（rename 撞上已有目录）时仍然返回可用书库，绝不抛错', async () => {
    await writeFile(libraryPath(), BROKEN_TEXT, 'utf8')
    // 让备份目标位置已经被一个目录占了：Windows 上 rename 会以 EPERM 失败，
    // library.ts 会吞掉它然后重新 load 同一个坏文件 —— 这正是 R4
    await mkdir(`${libraryPath()}.corrupt-${NOW}`)

    await expect(openLibrary(libraryPath(), () => NOW)).rejects.toSatisfy(isCorruptLibraryError)

    const boot = await openStorageForStartup(workDir, () => NOW)
    await expect(boot.library.list()).resolves.toEqual([])
    expect(boot.warnings).toHaveLength(1)
    expect(boot.warnings[0]).toContain('书库无法打开')
  })

  it('书库降级时得到的是内存实现，不会把空书库写回磁盘', async () => {
    await mkdir(libraryPath())

    const boot = await openStorageForStartup(workDir, () => NOW)

    expect(boot.library).toBeInstanceOf(InMemoryBookRepository)
    await boot.library.save(sampleBook('temp'))
    await expect(boot.library.get('temp')).resolves.toEqual(sampleBook('temp'))
    await expect(readdir(libraryPath())).resolves.toEqual([])
  })
})
