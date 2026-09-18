import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ANNOTATION_EXPORT_BOUNDARY_MESSAGE } from '@shared/ipc'
import {
  MAX_ANNOTATION_FILE_SIZE,
  UNTITLED_BOOK_TITLE,
  annotationFileName,
  readAnnotationText,
  writeAnnotationText
} from '../../../src/main/transfer/annotationFile'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'reader-annotation-file-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('annotationFileName', () => {
  it('拼出「书名-注解.json」', () => {
    expect(annotationFileName('三体')).toBe('三体-注解.json')
  })

  it('把 Windows 不接受的字符换成空格并合并空白', () => {
    expect(annotationFileName('三体/全集: 第一部?')).toBe('三体 全集 第一部-注解.json')
    expect(annotationFileName('a\\b*c"d<e>f|g')).toBe('a b c d e f g-注解.json')
  })

  it('掐掉结尾的点和空格（Windows 会静默丢掉它们，defaultPath 就对不上了）', () => {
    expect(annotationFileName('三体. ')).toBe('三体-注解.json')
    expect(annotationFileName('三体...')).toBe('三体-注解.json')
  })

  it('截断到 60 字，且截断后不会再留下结尾的点或空格', () => {
    const long = '长'.repeat(80)
    expect(annotationFileName(long)).toBe(`${'长'.repeat(60)}-注解.json`)

    // 第 60 个字符正好是分隔符时，只有截断之后再掐一次尾才干净
    expect(annotationFileName(`${'长'.repeat(59)} .尾`)).toBe(`${'长'.repeat(59)}-注解.json`)
  })

  it('洗完什么都不剩时回落固定名字', () => {
    expect(annotationFileName('')).toBe(`${UNTITLED_BOOK_TITLE}-注解.json`)
    expect(annotationFileName(' ?. ')).toBe(`${UNTITLED_BOOK_TITLE}-注解.json`)
  })
})

describe('readAnnotationText', () => {
  it('按 UTF-8 读回内容', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'in.json')
    await writeFile(path, '{"a":"中文"}', 'utf8')

    await expect(readAnnotationText(path)).resolves.toBe('{"a":"中文"}')
  })

  it('超过上限时在读取之前就拒绝', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'in.json')
    await writeFile(path, 'x'.repeat(100), 'utf8')

    await expect(readAnnotationText(path, 10)).rejects.toThrow('注解文件超过了大小上限')
  })

  it('正好等于上限时仍然放行', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'in.json')
    await writeFile(path, 'x'.repeat(10), 'utf8')

    await expect(readAnnotationText(path, 10)).resolves.toHaveLength(10)
  })

  it('目标不是普通文件时拒绝', async () => {
    const dir = await makeTempDir()
    const nested = join(dir, 'sub')
    await mkdir(nested)

    await expect(readAnnotationText(nested)).rejects.toThrow('导入的目标不是普通文件')
  })

  it('默认上限是 8 MB', () => {
    expect(MAX_ANNOTATION_FILE_SIZE).toBe(8 * 1024 * 1024)
  })
})

describe('writeAnnotationText', () => {
  const OUTSIDE = 'C:/Users/reader/AppData/Roaming/reader'

  it('写出内容，成功后不留临时文件', async () => {
    const dir = await makeTempDir()
    const target = join(dir, 'out.json')

    await writeAnnotationText(target, '{"k":1}', { mustStayOutside: OUTSIDE })

    await expect(readFile(target, 'utf8')).resolves.toBe('{"k":1}')
    await expect(readdir(dir)).resolves.toEqual(['out.json'])
  })

  it('覆盖已有文件', async () => {
    const dir = await makeTempDir()
    const target = join(dir, 'out.json')
    await writeFile(target, '旧的', 'utf8')

    await writeAnnotationText(target, '新的', { mustStayOutside: OUTSIDE })

    await expect(readFile(target, 'utf8')).resolves.toBe('新的')
    await expect(readdir(dir)).resolves.toEqual(['out.json'])
  })

  it('目标就是应用数据目录本身时拒绝', async () => {
    const dir = await makeTempDir()

    await expect(writeAnnotationText(dir, 'x', { mustStayOutside: dir })).rejects.toThrow(
      ANNOTATION_EXPORT_BOUNDARY_MESSAGE
    )
  })

  it('目标落在应用数据目录里时拒绝，且不留下临时文件', async () => {
    const dir = await makeTempDir()
    const target = join(dir, 'annotations.json')

    await expect(writeAnnotationText(target, 'x', { mustStayOutside: dir })).rejects.toThrow(
      ANNOTATION_EXPORT_BOUNDARY_MESSAGE
    )
    await expect(readdir(dir)).resolves.toEqual([])
  })

  it('只是前缀相同的兄弟目录不算越界', async () => {
    const dir = await makeTempDir()
    const target = join(dir, 'reader-backup', 'out.json')
    await mkdir(join(dir, 'reader-backup'))

    await writeAnnotationText(target, 'x', { mustStayOutside: join(dir, 'reader') })

    await expect(readFile(target, 'utf8')).resolves.toBe('x')
  })

  it('用 .. 绕出应用数据目录的路径不算越界（它确实落在外面）', async () => {
    const dir = await makeTempDir()
    const outside = join(dir, 'out.json')

    await writeAnnotationText(join(dir, 'reader', '..', 'out.json'), 'x', {
      mustStayOutside: join(dir, 'reader')
    })

    await expect(readFile(outside, 'utf8')).resolves.toBe('x')
  })

  it('写盘失败时清掉临时文件', async () => {
    const dir = await makeTempDir()
    const occupied = join(dir, 'occupied')
    // 目标是非空目录，rename 必定失败，此时已写好的临时文件必须被删掉
    await mkdir(occupied)
    await writeFile(join(occupied, 'keep.txt'), 'x')

    await expect(writeAnnotationText(occupied, 'x', { mustStayOutside: OUTSIDE })).rejects.toThrow()

    await expect(readdir(dir)).resolves.toEqual(['occupied'])
  })

  it('父目录不存在时失败且不留痕', async () => {
    const dir = await makeTempDir()

    await expect(
      writeAnnotationText(join(dir, 'missing', 'out.json'), 'x', { mustStayOutside: OUTSIDE })
    ).rejects.toThrow()

    await expect(readdir(dir)).resolves.toEqual([])
  })

  it('临时文件名带注入的后缀，不是固定的 .tmp', async () => {
    const dir = await makeTempDir()
    const target = join(dir, 'out.json')
    // 在临时文件的位置先放一个目录，writeFile 一定失败，报错信息里就带上了临时文件名。
    // 同一本书连点两次导出时，固定后缀会让两个写盘过程互相覆盖临时文件。
    await mkdir(join(dir, 'out.json.probe.tmp'))

    await expect(
      writeAnnotationText(target, 'x', { mustStayOutside: OUTSIDE, tempSuffix: 'probe' })
    ).rejects.toThrow('out.json.probe.tmp')

    // 清不掉的临时文件不能盖掉原始错误
    await expect(readdir(dir)).resolves.toEqual(['out.json.probe.tmp'])
  })
})
