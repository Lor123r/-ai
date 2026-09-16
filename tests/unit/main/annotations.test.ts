import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AnnotationCorruptError,
  isCorruptAnnotationError,
  serializeAnnotations
} from '@core/adapters/annotationSnapshot'
import { LibraryCorruptError, isCorruptLibraryError } from '@core/adapters/librarySnapshot'
import { createBookmark, type Annotation } from '@core/domain/annotation'
import {
  ANNOTATIONS_FILE_NAME,
  openAnnotations,
  resolveAnnotationsFilePath
} from '../../../src/main/storage/annotations'
import { LIBRARY_FILE_NAME, openLibrary, resolveLibraryFilePath } from '../../../src/main/storage/library'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const NOW = 1_700_000_000_000
const BROKEN_TEXT = '{ 这不是 JSON'

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ebook-reader-test-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

function sampleAnnotation(id = 'a1'): Annotation {
  return createBookmark({ id, bookId: 'b1', cfi: 'epubcfi(/6/4!/4/2)', note: '笔记' }, NOW)
}

function annotationsPath(): string {
  return join(workDir, ANNOTATIONS_FILE_NAME)
}

async function listCorruptBackups(): Promise<string[]> {
  const names = await readdir(workDir)
  return names.filter((name) => name.includes('.corrupt-')).sort()
}

describe('resolveAnnotationsFilePath', () => {
  it('固定落在数据目录下的 annotations.json', () => {
    expect(resolveAnnotationsFilePath('C:/userData')).toBe(join('C:/userData', ANNOTATIONS_FILE_NAME))
  })
})

describe('openAnnotations', () => {
  it('首次启动时得到空存档，不会提前创建文件', async () => {
    const filePath = annotationsPath()
    const { repository, recoveredFiles } = await openAnnotations(filePath)

    await expect(repository.listByBook('b1')).resolves.toEqual([])
    expect(recoveredFiles).toEqual([])
    await expect(readdir(workDir)).resolves.toEqual([])
  })

  it('存档不存在时也会成功打开（不备份任何文件）', async () => {
    const { recoveredFiles } = await openAnnotations(annotationsPath(), () => NOW)

    expect(recoveredFiles).toEqual([])
    await expect(readdir(workDir)).resolves.toEqual([])
  })

  it('写入的注解在下次启动（新进程）仍然存在', async () => {
    const filePath = annotationsPath()

    const first = await openAnnotations(filePath)
    await first.repository.save(sampleAnnotation('a1'))
    await first.repository.save(sampleAnnotation('a2'))
    await first.repository.remove('b1', 'a1')

    const second = await openAnnotations(filePath)
    await expect(second.repository.listByBook('b1')).resolves.toEqual([sampleAnnotation('a2')])
  })

  it('存档损坏时备份原文件并以空存档启动，保证应用仍能打开', async () => {
    const filePath = annotationsPath()
    await writeFile(filePath, BROKEN_TEXT, 'utf8')

    const { repository, recoveredFiles } = await openAnnotations(filePath, () => NOW)

    expect(recoveredFiles).toEqual([`${filePath}.corrupt-${NOW}`])
    await expect(readFile(recoveredFiles[0]!, 'utf8')).resolves.toBe(BROKEN_TEXT)
    await expect(repository.listByBook('b1')).resolves.toEqual([])
  })

  it('备份后仍可正常写入新存档', async () => {
    const filePath = annotationsPath()
    await writeFile(filePath, '[1,2,3]', 'utf8')

    const { repository } = await openAnnotations(filePath, () => NOW)
    await repository.save(sampleAnnotation('a1'))

    await expect(readFile(filePath, 'utf8')).resolves.toContain('"id": "a1"')
  })

  it('非损坏类错误（例如路径无法读取）原样抛出，也不留下备份', async () => {
    // 用一个同名目录制造 EISDIR：它既不是「文件不存在」，也不是「存档损坏」
    const filePath = annotationsPath()
    await mkdir(filePath)

    await expect(openAnnotations(filePath, () => NOW)).rejects.toThrow()
    await expect(listCorruptBackups()).resolves.toEqual([])
  })

  it('备份失败时仍然成功打开，错误留到读列表那一步', async () => {
    const filePath = annotationsPath()
    // 在备份目标位置先建一个目录：rename 到已存在的目录上会失败，用它模拟「备份写不下去」
    await mkdir(`${filePath}.corrupt-${NOW}`)
    await writeFile(filePath, BROKEN_TEXT, 'utf8')

    const { repository, recoveredFiles } = await openAnnotations(filePath, () => NOW)

    expect(recoveredFiles).toEqual([`${filePath}.corrupt-${NOW}`])
    // 刻意选择的降级：启动不受影响（坏文件仍留在磁盘上，用户还有机会自己救），
    // 错误留到能报给用户的那一层 —— 此时读列表才会抛出 AnnotationCorruptError。
    // 书库那边的恢复流程会在备份失败后再读一次，于是异常直接穿到启动流程。
    const error = await repository.listByBook('b1').then(
      () => null,
      (reason: unknown) => reason
    )
    expect(isCorruptAnnotationError(error)).toBe(true)
  })
})

describe('两种损坏错误互不识别', () => {
  it('注解损坏判定不认书库的损坏错误', () => {
    const error = new LibraryCorruptError('书库坏了')

    expect(isCorruptAnnotationError(error)).toBe(false)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('LibraryCorruptError')
  })

  it('书库损坏判定不认注解的损坏错误', () => {
    const error = new AnnotationCorruptError('注解坏了')

    expect(isCorruptLibraryError(error)).toBe(false)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AnnotationCorruptError')
  })
})

describe('注解存档与书库的文件级隔离', () => {
  it('注解存档损坏时不动书库文件', async () => {
    const libraryPath = resolveLibraryFilePath(workDir)
    const libraryText = '{\n  "version": 1,\n  "books": [],\n  "locators": {}\n}\n'
    await writeFile(libraryPath, libraryText, 'utf8')
    await writeFile(annotationsPath(), BROKEN_TEXT, 'utf8')

    const { recoveredFiles } = await openAnnotations(annotationsPath(), () => NOW)

    expect(recoveredFiles).toEqual([`${annotationsPath()}.corrupt-${NOW}`])
    await expect(listCorruptBackups()).resolves.toEqual([`${ANNOTATIONS_FILE_NAME}.corrupt-${NOW}`])
    // 书库文件必须逐字节不变，否则一份坏注解会连带毁掉书库
    await expect(readFile(libraryPath, 'utf8')).resolves.toBe(libraryText)

    // 书库照旧能打开，说明注解这边的恢复没有波及它
    const library = await openLibrary(libraryPath, () => NOW)
    expect(library.recoveredFiles).toEqual([])
    await expect(library.repository.list()).resolves.toEqual([])
  })

  it('书库损坏时不动注解存档', async () => {
    const annotationsText = serializeAnnotations([sampleAnnotation('a1')])
    await writeFile(annotationsPath(), annotationsText, 'utf8')
    const libraryPath = resolveLibraryFilePath(workDir)
    await writeFile(libraryPath, BROKEN_TEXT, 'utf8')

    const { recoveredFiles } = await openLibrary(libraryPath, () => NOW)

    expect(recoveredFiles).toEqual([`${libraryPath}.corrupt-${NOW}`])
    await expect(readFile(annotationsPath(), 'utf8')).resolves.toBe(annotationsText)
    await expect(listCorruptBackups()).resolves.toEqual([`${LIBRARY_FILE_NAME}.corrupt-${NOW}`])
    await expect(readdir(workDir)).resolves.not.toContain(`${ANNOTATIONS_FILE_NAME}.corrupt-${NOW}`)
  })

  it('备份文件名只与传入的路径有关，不会串到书库的路径上', async () => {
    // 传入一个不叫 annotations.json 的路径：备份必须只针对它
    const customPath = join(workDir, 'custom-annotations.json')
    await writeFile(customPath, BROKEN_TEXT, 'utf8')

    const { repository, recoveredFiles } = await openAnnotations(customPath, () => NOW)

    expect(recoveredFiles).toEqual([`${customPath}.corrupt-${NOW}`])
    await repository.save(sampleAnnotation('a1'))
    await expect(readFile(customPath, 'utf8')).resolves.toContain('"id": "a1"')
  })
})
