import { describe, expect, it } from 'vitest'
import { createBookmark, createHighlight, type Annotation } from '@core/domain/annotation'
import type { AnnotationRepository } from '@core/ports/annotationRepository'

const NOW = 1_700_000_000_000
const CFI = 'epubcfi(/6/4!/4/2/2)'

function bookmark(id: string, bookId = 'b1', createdAt = NOW, note = ''): Annotation {
  return createBookmark({ id, bookId, cfi: CFI, chapterHref: 'ch1.xhtml', percent: 0.25, note }, createdAt)
}

function highlight(id: string, bookId = 'b1', createdAt = NOW): Annotation {
  return createHighlight(
    { id, bookId, cfi: CFI, percent: 0.5, excerpt: '摘录', color: 'green' },
    createdAt
  )
}

/**
 * 任何 AnnotationRepository 实现都必须满足的语义。
 * JsonAnnotationRepository 与 InMemoryAnnotationRepository 跑同一份契约：
 * 内存实现是浏览器预览与单测的替身，它一旦与落盘实现漂移，
 * 「本地测试全绿、装了应用才丢数据」这类问题就会从这里漏出去。
 */
export function describeAnnotationRepositoryContract(
  name: string,
  createRepository: () => AnnotationRepository
): void {
  describe(`AnnotationRepository 契约：${name}`, () => {
    it('初始状态为空', async () => {
      const repo = createRepository()

      await expect(repo.listByBook('b1')).resolves.toEqual([])
    })

    it('保存后可以读回，且不与内部状态共享引用', async () => {
      const repo = createRepository()
      const original = bookmark('a1')
      await repo.save(original)

      const loaded = await repo.listByBook('b1')
      expect(loaded).toEqual([original])

      loaded[0]!.note = '被外部篡改'
      await expect(repo.listByBook('b1')).resolves.toEqual([original])
    })

    it('按 createdAt 倒序返回，时间相同时用 id 升序兜底', async () => {
      const repo = createRepository()
      await repo.save(bookmark('old', 'b1', NOW - 3000))
      await repo.save(bookmark('new', 'b1', NOW - 1000))
      await repo.save(bookmark('middle', 'b1', NOW - 2000))
      await repo.save(bookmark('b-tie', 'b1', NOW))
      await repo.save(bookmark('a-tie', 'b1', NOW))

      const ids = (await repo.listByBook('b1')).map((item) => item.id)
      expect(ids).toEqual(['a-tie', 'b-tie', 'new', 'middle', 'old'])
    })

    it('只返回指定书籍的注解，不同书的同名 id 互不影响', async () => {
      const repo = createRepository()
      await repo.save(bookmark('shared', 'b1', NOW))
      await repo.save(bookmark('shared', 'b2', NOW, '另一本书的笔记'))

      await expect(repo.listByBook('b1')).resolves.toEqual([bookmark('shared', 'b1', NOW)])
      await expect(repo.listByBook('b2')).resolves.toEqual([
        bookmark('shared', 'b2', NOW, '另一本书的笔记')
      ])
    })

    it('同一个 (bookId, id) 重复保存是覆盖而不是插入', async () => {
      const repo = createRepository()
      await repo.save(bookmark('a1', 'b1', NOW))
      await repo.save(bookmark('a1', 'b1', NOW + 500, '改过的笔记'))

      await expect(repo.listByBook('b1')).resolves.toEqual([bookmark('a1', 'b1', NOW + 500, '改过的笔记')])
    })

    it('书签与划线混在同一个列表里按时间排序', async () => {
      const repo = createRepository()
      await repo.save(bookmark('a1', 'b1', NOW - 1000))
      await repo.save(highlight('a2', 'b1', NOW))

      const list = await repo.listByBook('b1')
      expect(list.map((item) => item.kind)).toEqual(['highlight', 'bookmark'])
    })

    it('删除后不再返回，且不影响同一本书的其它注解', async () => {
      const repo = createRepository()
      await repo.save(bookmark('a1'))
      await repo.save(bookmark('a2'))
      await repo.remove('b1', 'a1')

      await expect(repo.listByBook('b1')).resolves.toEqual([bookmark('a2')])
    })

    it('删除不存在的注解是幂等的', async () => {
      const repo = createRepository()

      await expect(repo.remove('b1', 'ghost')).resolves.toBeUndefined()
      await expect(repo.remove('b1', 'ghost')).resolves.toBeUndefined()
    })

    it('删除只影响同书同 id：别的书上同名 id 仍在', async () => {
      const repo = createRepository()
      await repo.save(bookmark('shared', 'b1'))
      await repo.save(bookmark('shared', 'b2'))

      await repo.remove('b1', 'shared')

      await expect(repo.listByBook('b1')).resolves.toEqual([])
      await expect(repo.listByBook('b2')).resolves.toEqual([bookmark('shared', 'b2')])
    })

    it('removeByBook 删掉整本书的注解并返回条数', async () => {
      const repo = createRepository()
      await repo.save(bookmark('a1', 'b1'))
      await repo.save(highlight('a2', 'b1'))
      await repo.save(bookmark('a3', 'b2'))

      await expect(repo.removeByBook('b1')).resolves.toBe(2)
      await expect(repo.listByBook('b1')).resolves.toEqual([])
      await expect(repo.listByBook('b2')).resolves.toEqual([bookmark('a3', 'b2')])
    })

    it('removeByBook 对没有注解的书返回 0', async () => {
      const repo = createRepository()

      await expect(repo.removeByBook('b1')).resolves.toBe(0)
    })

    it('并发保存不会互相覆盖', async () => {
      const repo = createRepository()
      await Promise.all(
        Array.from({ length: 30 }, (_, index) => repo.save(bookmark(`a-${index}`, 'b1', NOW + index)))
      )

      const list = await repo.listByBook('b1')
      expect(list).toHaveLength(30)
      expect(list[0]!.id).toBe('a-29')
    })

    it('load 可以重复调用，且不会清掉已有数据', async () => {
      const repo = createRepository()
      await repo.save(bookmark('a1'))

      await repo.load()
      await repo.load()

      await expect(repo.listByBook('b1')).resolves.toEqual([bookmark('a1')])
    })
  })
}
