import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_FORMAT_VERSION,
  isCorruptAnnotationError,
  serializeAnnotations
} from '@core/adapters/annotationSnapshot'
import { InMemoryTextStore } from '@core/adapters/inMemoryTextStore'
import { JsonAnnotationRepository } from '@core/adapters/jsonAnnotationRepository'
import {
  MAX_ANNOTATIONS_PER_BOOK,
  createBookmark,
  createHighlight,
  type Annotation
} from '@core/domain/annotation'
import type { TextStore } from '@core/ports/textStore'

const NOW = 1_700_000_000_000

function bookmark(id: string, createdAt = NOW, bookId = 'b1'): Annotation {
  return createBookmark({ id, bookId, cfi: 'epubcfi(/6/4!/4/2)' }, createdAt)
}

function highlight(id: string, createdAt = NOW, bookId = 'b1'): Annotation {
  return createHighlight(
    { id, bookId, cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)', excerpt: '片段', color: 'blue' },
    createdAt
  )
}

/** 记录读盘次数的文本存储：不上报读次数就钉不住「懒加载只读一次」。 */
class CountingTextStore implements TextStore {
  reads = 0
  readonly writes: string[] = []
  private content: string | null

  constructor(initial: string | null = null) {
    this.content = initial
  }

  async read(): Promise<string | null> {
    this.reads += 1
    return this.content
  }

  async write(content: string): Promise<void> {
    this.writes.push(content)
    this.content = content
  }
}

/** 造一份「每本书已经存满」的存档文本。 */
function fullSnapshot(count = MAX_ANNOTATIONS_PER_BOOK, bookId = 'b1'): string {
  return serializeAnnotations(
    Array.from({ length: count }, (_, index) => bookmark(`a${index}`, NOW - index, bookId))
  )
}

describe('JsonAnnotationRepository 持久化', () => {
  it('第一次操作时才真正读盘，之后再读也用内存状态', async () => {
    const store = new CountingTextStore()
    const repo = new JsonAnnotationRepository(store)
    expect(store.reads).toBe(0)

    await expect(repo.listByBook('b1')).resolves.toEqual([])
    expect(store.reads).toBe(1)

    await repo.save(bookmark('a1'))
    await expect(repo.listByBook('b1')).resolves.toEqual([bookmark('a1')])
    expect(store.reads).toBe(1)
  })

  it('新建实例能从同一份文本还原注解', async () => {
    const store = new InMemoryTextStore()
    const first = new JsonAnnotationRepository(store, () => NOW)
    await first.save(bookmark('a1'))
    await first.save(highlight('h1', NOW + 1000))

    const second = new JsonAnnotationRepository(store, () => NOW)
    await expect(second.listByBook('b1')).resolves.toEqual([highlight('h1', NOW + 1000), bookmark('a1')])
  })

  it('落盘内容是合法 JSON 且带格式版本号，便于将来迁移', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store)
    await repo.save(bookmark('a1'))

    const parsed = JSON.parse(store.current ?? '') as { version: number; annotations: unknown[] }
    expect(parsed.version).toBe(ANNOTATION_FORMAT_VERSION)
    expect(parsed.annotations).toHaveLength(1)
  })

  it('同一个 (bookId, id) 重复保存是覆盖而不是新增', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store, () => NOW)

    await repo.save(bookmark('a1'))
    await repo.save(highlight('a1', NOW + 500))

    await expect(repo.listByBook('b1')).resolves.toEqual([highlight('a1', NOW + 500)])
    expect((JSON.parse(store.current ?? '') as { annotations: unknown[] }).annotations).toHaveLength(1)
  })

  it('只返回该书的注解，顺序由 compareAnnotationsForList 决定', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store)

    await repo.save(bookmark('a', NOW - 2000))
    await repo.save(bookmark('b', NOW))
    await repo.save(bookmark('other', NOW, 'b2'))
    await repo.save(bookmark('c', NOW - 1000))

    await expect(repo.listByBook('b1')).resolves.toEqual([
      bookmark('b', NOW),
      bookmark('c', NOW - 1000),
      bookmark('a', NOW - 2000)
    ])
    await expect(repo.listByBook('b2')).resolves.toEqual([bookmark('other', NOW, 'b2')])
  })

  it('返回的是副本，调用方改动不会污染内部状态', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store)
    await repo.save(bookmark('a1'))

    const listed = await repo.listByBook('b1')
    listed[0]!.note = '被外面改掉了'

    await expect(repo.listByBook('b1')).resolves.toEqual([bookmark('a1')])
  })

  it('remove 是幂等的：删不存在的不抛错，删过的读不到', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store)
    await repo.save(bookmark('a1'))

    await expect(repo.remove('b1', '不存在')).resolves.toBeUndefined()
    await repo.remove('b1', 'a1')

    await expect(repo.listByBook('b1')).resolves.toEqual([])
    await expect(repo.remove('b1', 'a1')).resolves.toBeUndefined()
  })

  it('removeByBook 返回删除条数，且不碰别的书', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store)
    await repo.save(bookmark('a1'))
    await repo.save(bookmark('a2', NOW - 10))
    await repo.save(bookmark('other', NOW, 'b2'))

    await expect(repo.removeByBook('b1')).resolves.toBe(2)
    await expect(repo.listByBook('b1')).resolves.toEqual([])
    await expect(repo.listByBook('b2')).resolves.toEqual([bookmark('other', NOW, 'b2')])
    await expect(repo.removeByBook('b1')).resolves.toBe(0)
  })

  it('removeByBook 没有任何改动时完全不写盘', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store)

    await expect(repo.removeByBook('b1')).resolves.toBe(0)
    expect(store.writes).toEqual([])
    expect(store.current).toBeNull()

    await repo.save(bookmark('a1'))
    const writesAfterSave = store.writes.length
    await expect(repo.removeByBook('b2')).resolves.toBe(0)
    expect(store.writes).toHaveLength(writesAfterSave)
  })

  it('达到每本书上限后新增抛错，但覆盖已有 id 仍然允许', async () => {
    const store = new InMemoryTextStore(fullSnapshot())
    const repo = new JsonAnnotationRepository(store, () => NOW)

    await expect(repo.save(bookmark('a-new'))).rejects.toThrow('注解数量已达上限')
    await expect(repo.save(bookmark('a0'))).resolves.toBeUndefined()
    await expect(repo.listByBook('b1')).resolves.toHaveLength(MAX_ANNOTATIONS_PER_BOOK)
  })

  it('上限按书算，别的书没有被牵连', async () => {
    const store = new InMemoryTextStore(fullSnapshot())
    const repo = new JsonAnnotationRepository(store, () => NOW)

    await expect(repo.save(bookmark('a1', NOW, 'b2'))).resolves.toBeUndefined()
    await expect(repo.listByBook('b2')).resolves.toEqual([bookmark('a1', NOW, 'b2')])
  })

  it('磁盘存档损坏时 load 抛出可识别的 AnnotationCorruptError', async () => {
    const store = new InMemoryTextStore('{ 这不是 JSON')

    const error = await new JsonAnnotationRepository(store).load().then(
      () => null,
      (reason: unknown) => reason
    )
    expect(isCorruptAnnotationError(error)).toBe(true)
  })

  it('单条记录损坏只丢弃该条，其余注解照常读出', async () => {
    const store = new InMemoryTextStore(
      JSON.stringify({
        version: 1,
        annotations: [bookmark('good'), { id: 'a b', bookId: 'b1', kind: 'bookmark', cfi: 'epubcfi(/6/4)' }]
      })
    )

    await expect(new JsonAnnotationRepository(store).listByBook('b1')).resolves.toEqual([bookmark('good')])
  })

  it('多个并发保存不会互相覆盖（串行化写入）', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store)

    await Promise.all([repo.save(bookmark('a')), repo.save(bookmark('b')), repo.save(bookmark('c'))])

    await expect(repo.listByBook('b1')).resolves.toHaveLength(3)
    expect((JSON.parse(store.current ?? '') as { annotations: unknown[] }).annotations).toHaveLength(3)
  })

  it('写盘失败时错误会向上抛出，而不是被静默吞掉', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store)
    store.failWith(new Error('磁盘已满'))

    await expect(repo.save(bookmark('a1'))).rejects.toThrow('磁盘已满')
  })

  it('一次写盘失败后仍可继续使用（锁不会卡死）', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonAnnotationRepository(store)
    store.failWith(new Error('磁盘已满'))
    await expect(repo.save(bookmark('a1'))).rejects.toThrow('磁盘已满')

    store.failWith(null)
    await repo.save(bookmark('a1'))
    await expect(repo.listByBook('b1')).resolves.toEqual([bookmark('a1')])
  })
})
