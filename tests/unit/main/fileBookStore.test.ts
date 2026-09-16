import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  BOOKS_DIR_NAME,
  COVERS_DIR_NAME,
  FileBookStore
} from '../../../src/main/import/fileBookStore'
import { buildEpubFile } from '../../support/epubFixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let workDir: string
let sourceDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'ebook-store-test-'))
  sourceDir = join(workDir, 'sources')
  await mkdir(sourceDir, { recursive: true })
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

function createStore(maxFileSize?: number): FileBookStore {
  return new FileBookStore({ userDataDir: workDir, maxFileSize })
}

async function readBytes(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(filePath))
}

describe('FileBookStore.import', () => {
  it('把文件复制进 books 目录，文件名用内容摘要', async () => {
    const source = await buildEpubFile(join(sourceDir, '三体.epub'), { title: '三体' })
    const original = await readBytes(source)

    const result = await createStore().import([source])

    expect(result.failed).toEqual([])
    const [file] = result.imported
    expect(file).toMatchObject({ sourcePath: source, format: 'epub', fileSize: original.byteLength })
    expect(file?.contentHash).toBe(createHash('sha256').update(original).digest('hex'))
    expect(basename(file!.filePath)).toBe(`${file!.contentHash}.epub`)
    expect(await readBytes(file!.filePath)).toEqual(original)
  })

  it('同一份内容重复导入只占一份磁盘空间', async () => {
    const store = createStore()
    const first = await buildEpubFile(join(sourceDir, 'a.epub'))
    const second = await buildEpubFile(join(sourceDir, 'b.epub'))

    await store.import([first])
    await store.import([second])

    await expect(readdir(store.getBooksDir())).resolves.toHaveLength(1)
  })

  it('不支持的扩展名给出可读原因', async () => {
    const source = join(sourceDir, '说明书.pdf')
    await writeFile(source, 'pdf')

    const result = await createStore().import([source])

    expect(result.imported).toEqual([])
    expect(result.failed).toEqual([{ sourcePath: source, reason: '暂不支持该文件格式' }])
  })

  it('文件不存在或路径是目录时只记失败，不抛异常', async () => {
    const directory = join(sourceDir, '假书.epub')
    await mkdir(directory)

    const result = await createStore().import([join(sourceDir, '不存在.epub'), directory])

    expect(result.imported).toEqual([])
    expect(result.failed).toHaveLength(2)
  })

  it('空文件被拒绝', async () => {
    const source = join(sourceDir, '空.epub')
    await writeFile(source, '')

    const result = await createStore().import([source])

    expect(result.failed).toEqual([{ sourcePath: source, reason: '文件是空的' }])
  })

  it('超过大小上限的文件被拒绝', async () => {
    const source = await buildEpubFile(join(sourceDir, '大书.epub'))

    const result = await createStore(16).import([source])

    expect(result.failed).toEqual([{ sourcePath: source, reason: '文件过大' }])
    await expect(readdir(join(workDir, BOOKS_DIR_NAME))).rejects.toThrow()
  })

  it('一批里有的成功有的失败时互不影响', async () => {
    const good = await buildEpubFile(join(sourceDir, '好书.epub'))
    const bad = join(sourceDir, '不受支持.pdf')
    await writeFile(bad, 'pdf')

    const result = await createStore().import([good, bad])

    expect(result.imported).toHaveLength(1)
    expect(result.failed).toEqual([{ sourcePath: bad, reason: '暂不支持该文件格式' }])
  })

  it('复制阶段不校验内容，读不懂的 EPUB 由导入服务负责判定', async () => {
    const source = join(sourceDir, '坏书.epub')
    await writeFile(source, 'not a zip')

    const result = await createStore().import([source])

    expect(result.failed).toEqual([])
    expect(result.imported).toHaveLength(1)
  })
})

describe('FileBookStore.read', () => {
  it('读回已导入文件的原始字节', async () => {
    const store = createStore()
    const source = await buildEpubFile(join(sourceDir, '三体.epub'))
    const { imported } = await store.import([source])

    await expect(store.read(imported[0]!.filePath)).resolves.toEqual(await readBytes(source))
  })

  it('读书库目录之外的文件会被拒绝', async () => {
    const store = createStore()
    const outside = join(workDir, 'library.json')
    await writeFile(outside, '{"secret":true}')

    await expect(store.read(outside)).rejects.toThrow('文件不在书库目录内')
    await expect(store.read(join(workDir, '..', 'anything.epub'))).rejects.toThrow('文件不在书库目录内')
  })

  it('文件不存在时报错', async () => {
    const store = createStore()

    await expect(store.read(join(store.getBooksDir(), 'missing.epub'))).rejects.toThrow()
  })
})

describe('FileBookStore.writeCover', () => {
  it('封面写进 covers 目录，文件名由书籍 id 与扩展名拼成', async () => {
    const store = createStore()

    const coverPath = await store.writeCover('abc123', new Uint8Array([1, 2, 3]), 'png')

    expect(basename(coverPath)).toBe('abc123.png')
    expect(coverPath).toBe(join(workDir, COVERS_DIR_NAME, 'abc123.png'))
    expect(await readBytes(coverPath)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('会清掉文件名里的路径分隔符等危险字符', async () => {
    const store = createStore()

    const coverPath = await store.writeCover('../../evil id', new Uint8Array([9]), 'jpg')

    expect(basename(coverPath)).toBe('evilid.jpg')
    expect(coverPath.startsWith(store.getCoversDir())).toBe(true)
  })

  it('清理后为空的标识或扩展名会被拒绝', async () => {
    const store = createStore()

    await expect(store.writeCover('///', new Uint8Array([1]), 'png')).rejects.toThrow('非法的文件标识')
    await expect(store.writeCover('abc', new Uint8Array([1]), '!!!')).rejects.toThrow('非法的文件扩展名')
  })
})

describe('FileBookStore.readCover', () => {
  it('读回写入的封面字节', async () => {
    const store = createStore()
    const coverPath = await store.writeCover('abc123', new Uint8Array([1, 2, 3]), 'png')

    await expect(store.readCover(coverPath)).resolves.toEqual(new Uint8Array([1, 2, 3]))
  })

  it('封面文件被删掉时返回 null，不抛错', async () => {
    const store = createStore()
    const coverPath = await store.writeCover('abc123', new Uint8Array([1]), 'png')
    await rm(coverPath, { force: true })

    await expect(store.readCover(coverPath)).resolves.toBeNull()
  })

  it('读书库目录之外的文件会被拒绝', async () => {
    const store = createStore()
    const outside = join(workDir, 'library.json')
    await writeFile(outside, '{}')

    await expect(store.readCover(outside)).rejects.toThrow('文件不在书库目录内')
  })
})

describe('FileBookStore.remove / exists', () => {
  it('删除已导入的文件后 exists 变为 false', async () => {
    const store = createStore()
    const source = await buildEpubFile(join(sourceDir, '三体.epub'))
    const { imported } = await store.import([source])
    const { filePath, contentHash } = imported[0]!

    await expect(store.exists(filePath)).resolves.toBe(true)
    await store.remove(contentHash, filePath)
    await expect(store.exists(filePath)).resolves.toBe(false)
  })

  it('删除不存在的文件不报错，删除书库之外的文件会被拒绝', async () => {
    const store = createStore()
    const outside = join(sourceDir, '重要文件.epub')
    await writeFile(outside, 'keep me')

    const missing = join(store.getBooksDir(), 'missing.epub')
    await expect(store.remove('missing', missing)).resolves.toBeUndefined()
    await expect(store.remove('重要文件', outside)).rejects.toThrow('文件不在书库目录内')
    await expect(readFile(outside, 'utf8')).resolves.toBe('keep me')
  })

  it('删的必须是这本书自己的文件，串到同一目录里别人的文件上会被拒绝', async () => {
    const store = createStore()
    const first = await buildEpubFile(join(sourceDir, 'a.epub'), { title: 'A' })
    const second = await buildEpubFile(join(sourceDir, 'b.epub'), { title: 'B' })
    const { imported } = await store.import([first, second])
    const files = imported.map((file) => file.filePath)

    // 书库存档是明文，filePath 可以被改成同目录里另一本书的路径；
    // 只校验「在 books/ 内」挡不住这种串号，删掉的就是别人的正文
    await expect(store.remove(imported[0]!.contentHash, files[1]!)).rejects.toThrow('文件不属于这本书')

    await expect(store.exists(files[0]!)).resolves.toBe(true)
    await expect(store.exists(files[1]!)).resolves.toBe(true)
  })

  it('书库目录自身不能被当成书籍文件删掉', async () => {
    const store = createStore()
    const source = await buildEpubFile(join(sourceDir, '三体.epub'))
    const { imported } = await store.import([source])
    const booksDir = store.getBooksDir()

    await expect(store.remove(imported[0]!.contentHash, booksDir)).rejects.toThrow('文件不在书库目录内')

    await expect(store.exists(imported[0]!.filePath)).resolves.toBe(true)
  })

  it('exists 对目录与不存在的路径都返回 false', async () => {
    const store = createStore()
    await mkdir(store.getBooksDir(), { recursive: true })
    await mkdir(join(store.getBooksDir(), 'dir.epub'))

    await expect(store.exists(store.getBooksDir())).resolves.toBe(false)
    await expect(store.exists(join(store.getBooksDir(), 'dir.epub'))).resolves.toBe(false)
    await expect(store.exists(join(workDir, 'library.json'))).resolves.toBe(false)
  })
})

describe('FileBookStore.removeCover', () => {
  it('删掉封面后 readCover 返回 null', async () => {
    const store = createStore()
    const coverPath = await store.writeCover('abc123', new Uint8Array([1, 2, 3]), 'png')

    await store.removeCover('abc123', coverPath)

    await expect(store.readCover(coverPath)).resolves.toBeNull()
  })

  it('删不存在的封面不报错', async () => {
    const store = createStore()
    const missing = join(store.getCoversDir(), 'missing.png')

    await expect(store.removeCover('missing', missing)).resolves.toBeUndefined()
  })

  it('两处目录不能互串：封面路径不能交给 remove，书籍路径不能交给 removeCover', async () => {
    const store = createStore()
    const source = await buildEpubFile(join(sourceDir, '三体.epub'))
    const { imported } = await store.import([source])
    const bookFilePath = imported[0]!.filePath
    const coverPath = await store.writeCover('abc123', new Uint8Array([1]), 'png')

    await expect(store.remove('abc123', coverPath)).rejects.toThrow('文件不在书库目录内')
    await expect(store.removeCover('abc123', bookFilePath)).rejects.toThrow('文件不在书库目录内')

    // 被拒绝之后两个文件都得原样还在，拒绝不能是「先删了再报错」
    await expect(store.exists(bookFilePath)).resolves.toBe(true)
    await expect(store.readCover(coverPath)).resolves.toEqual(new Uint8Array([1]))
  })

  it('删的必须是这本书自己的封面，串到别人的封面上会被拒绝', async () => {
    const store = createStore()
    const first = await store.writeCover('abc123', new Uint8Array([1]), 'png')
    const second = await store.writeCover('def456', new Uint8Array([2]), 'png')

    await expect(store.removeCover('abc123', second)).rejects.toThrow('文件不属于这本书')

    await expect(store.readCover(first)).resolves.toEqual(new Uint8Array([1]))
    await expect(store.readCover(second)).resolves.toEqual(new Uint8Array([2]))
  })

  it('书库目录之外的文件会被拒绝', async () => {
    const store = createStore()
    const outside = join(sourceDir, '重要图片.png')
    await writeFile(outside, 'keep me')

    await expect(store.removeCover('重要图片', outside)).rejects.toThrow('文件不在书库目录内')
    await expect(readFile(outside, 'utf8')).resolves.toBe('keep me')
  })

  it('目标是目录时抛出错误，而不是把目录连内容一起删掉', async () => {
    const store = createStore()
    const dir = join(store.getCoversDir(), 'cover.png')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'inner.txt'), 'keep me')

    await expect(store.removeCover('cover', dir)).rejects.toThrow()

    await expect(readFile(join(dir, 'inner.txt'), 'utf8')).resolves.toBe('keep me')
  })

  it('封面目录自身不能被当成封面文件删掉', async () => {
    const store = createStore()
    const coverPath = await store.writeCover('abc123', new Uint8Array([1]), 'png')
    const coversDir = store.getCoversDir()

    await expect(store.removeCover('abc123', coversDir)).rejects.toThrow('文件不在书库目录内')

    await expect(store.readCover(coverPath)).resolves.toEqual(new Uint8Array([1]))
  })
})
