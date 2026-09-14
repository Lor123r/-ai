import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBook } from '@core/domain/book'
import { createLocator } from '@core/domain/progress'
import { FileTextStore } from '../../../src/main/storage/fileTextStore'
import { LIBRARY_FILE_NAME, openLibrary, resolveLibraryFilePath } from '../../../src/main/storage/library'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const NOW = 1_700_000_000_000

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ebook-reader-test-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

function sampleBook(id = 'a') {
  return {
    ...createBook({ id, title: '样书', format: 'epub', filePath: `C:/lib/${id}.epub`, fileSize: 1024 }),
    addedAt: NOW
  }
}

describe('FileTextStore', () => {
  it('文件不存在时返回 null，而不是抛错', async () => {
    await expect(new FileTextStore(join(workDir, 'missing.json')).read()).resolves.toBeNull()
  })

  it('写入后能原样读回，并自动创建缺失的父目录', async () => {
    const filePath = join(workDir, 'nested', 'deeper', 'library.json')
    const store = new FileTextStore(filePath)

    await store.write('{"hello":"世界"}')
    await expect(store.read()).resolves.toBe('{"hello":"世界"}')
  })

  it('写入是原子替换：不会留下临时文件', async () => {
    const filePath = join(workDir, LIBRARY_FILE_NAME)
    const store = new FileTextStore(filePath)

    await store.write('第一次')
    await store.write('第二次')

    await expect(readFile(filePath, 'utf8')).resolves.toBe('第二次')
    await expect(readdir(workDir)).resolves.toEqual([LIBRARY_FILE_NAME])
  })

  it('覆盖写入失败（父路径是文件）时会抛出错误', async () => {
    const blocker = join(workDir, 'blocker')
    await writeFile(blocker, 'x', 'utf8')

    await expect(new FileTextStore(join(blocker, 'library.json')).write('y')).rejects.toThrow()
  })
})

describe('resolveLibraryFilePath', () => {
  it('固定落在数据目录下的 library.json', () => {
    expect(resolveLibraryFilePath('C:/userData')).toBe(join('C:/userData', LIBRARY_FILE_NAME))
  })
})

describe('openLibrary', () => {
  it('首次启动时得到空书库，不会提前创建文件', async () => {
    const filePath = join(workDir, LIBRARY_FILE_NAME)
    const { repository, recoveredFiles } = await openLibrary(filePath)

    await expect(repository.list()).resolves.toEqual([])
    expect(recoveredFiles).toEqual([])
    await expect(readdir(workDir)).resolves.toEqual([])
  })

  it('写入的书籍在下次启动（新进程）仍然存在', async () => {
    const filePath = join(workDir, LIBRARY_FILE_NAME)

    const first = await openLibrary(filePath)
    await first.repository.save(sampleBook('a'))
    await first.repository.saveLocator('a', createLocator({ cfi: 'epubcfi(/6/4)', percent: 0.3 }, NOW))

    const second = await openLibrary(filePath)
    await expect(second.repository.list()).resolves.toEqual([sampleBook('a')])
    await expect(second.repository.getLocator('a')).resolves.toEqual(
      createLocator({ cfi: 'epubcfi(/6/4)', percent: 0.3 }, NOW)
    )
  })

  it('存档损坏时备份原文件并以空书库启动，保证应用仍能打开', async () => {
    const filePath = join(workDir, LIBRARY_FILE_NAME)
    await writeFile(filePath, '{ 这不是 JSON', 'utf8')

    const { repository, recoveredFiles } = await openLibrary(filePath, () => NOW)

    expect(recoveredFiles).toEqual([`${filePath}.corrupt-${NOW}`])
    await expect(readFile(recoveredFiles[0]!, 'utf8')).resolves.toBe('{ 这不是 JSON')
    await expect(repository.list()).resolves.toEqual([])
  })

  it('备份后仍可正常写入新书库', async () => {
    const filePath = join(workDir, LIBRARY_FILE_NAME)
    await writeFile(filePath, '[1,2,3]', 'utf8')

    const { repository } = await openLibrary(filePath, () => NOW)
    await repository.save(sampleBook('a'))

    await expect(readFile(filePath, 'utf8')).resolves.toContain('"id": "a"')
  })

  it('存档不存在时也会成功打开（不备份任何文件）', async () => {
    const filePath = join(workDir, LIBRARY_FILE_NAME)
    const { recoveredFiles } = await openLibrary(filePath, () => NOW)

    expect(recoveredFiles).toEqual([])
    await expect(readdir(workDir)).resolves.toEqual([])
  })

  it('非损坏类错误（例如路径无法读取）原样抛出，不静默吞掉', async () => {
    // 用一个同名目录制造 EISDIR：它既不是「文件不存在」，也不是「存档损坏」
    const filePath = join(workDir, LIBRARY_FILE_NAME)
    await mkdir(filePath)

    await expect(openLibrary(filePath)).rejects.toThrow(/EISDIR|directory/i)
  })
})
