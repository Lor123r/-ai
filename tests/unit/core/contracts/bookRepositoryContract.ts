import { describe, expect, it } from 'vitest'
import { createBook, type Book } from '@core/domain/book'
import { createLocator } from '@core/domain/progress'
import type { BookRepository } from '@core/ports/bookRepository'

function book(overrides: Partial<Parameters<typeof createBook>[0]> & { id: string }): Book {
  return createBook({
    title: '样例书籍',
    author: '佚名',
    format: 'epub',
    filePath: `C:/lib/${overrides.id}.epub`,
    fileSize: 1024,
    ...overrides
  })
}

const NOW = 1_700_000_000_000

/**
 * 任何 BookRepository 实现都必须满足的语义。
 * 新增 SQLite / IPC 适配器时复用这份契约，避免实现之间行为漂移。
 */
export function describeBookRepositoryContract(name: string, createRepository: () => BookRepository): void {
  describe(`BookRepository 契约：${name}`, () => {
    it('初始状态为空', async () => {
      const repo = createRepository()
      await expect(repo.list()).resolves.toEqual([])
      await expect(repo.get('missing')).resolves.toBeNull()
    })

    it('保存后可以按 id 读回，且不与内部状态共享引用', async () => {
      const repo = createRepository()
      const original = book({ id: 'a' })
      await repo.save(original)

      const loaded = await repo.get('a')
      expect(loaded).toEqual(original)

      loaded!.title = '被外部篡改'
      await expect(repo.get('a')).resolves.toMatchObject({ title: '样例书籍' })
    })

    it('list 返回书架顺序：最近阅读在前，其次按导入时间倒序', async () => {
      const repo = createRepository()
      await repo.save({ ...book({ id: 'old' }), addedAt: NOW - 3000 })
      await repo.save({ ...book({ id: 'new' }), addedAt: NOW - 1000 })
      await repo.save({ ...book({ id: 'middle' }), addedAt: NOW - 2000 })
      await repo.markOpened('old', NOW)

      const ids = (await repo.list()).map((item) => item.id)
      expect(ids).toEqual(['old', 'new', 'middle'])
    })

    it('重复保存同一 id 不会产生副本，也不会覆盖导入时间', async () => {
      const repo = createRepository()
      await repo.save({ ...book({ id: 'a' }), addedAt: NOW - 5000 })
      await repo.save({ ...book({ id: 'a', title: '改过标题' }), addedAt: NOW })

      const list = await repo.list()
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ id: 'a', title: '改过标题', addedAt: NOW - 5000 })
    })

    it('markOpened 更新最近阅读时间但保持其它字段不变', async () => {
      const repo = createRepository()
      await repo.save(book({ id: 'a' }))

      await repo.markOpened('a', NOW)
      await expect(repo.get('a')).resolves.toMatchObject({ id: 'a', title: '样例书籍', lastOpenedAt: NOW })
    })

    it('操作不存在的书籍会抛出明确错误', async () => {
      const repo = createRepository()
      await expect(repo.markOpened('ghost', NOW)).rejects.toThrow(/ghost/)
      await expect(repo.saveLocator('ghost', createLocator({ percent: 0.5 }, NOW))).rejects.toThrow(/ghost/)
    })

    it('进度可以保存并读回，未记录时返回 null', async () => {
      const repo = createRepository()
      await repo.save(book({ id: 'a' }))

      await expect(repo.getLocator('a')).resolves.toBeNull()

      const locator = createLocator({ cfi: 'epubcfi(/6/4!/4/2/2)', percent: 0.42, chapterIndex: 3 }, NOW)
      await repo.saveLocator('a', locator)
      await expect(repo.getLocator('a')).resolves.toEqual(locator)

      const updated = createLocator({ cfi: 'epubcfi(/6/4!/4/8/2)', percent: 0.61, chapterIndex: 5 }, NOW + 1)
      await repo.saveLocator('a', updated)
      await expect(repo.getLocator('a')).resolves.toEqual(updated)
    })

    it('删除书籍会同时清掉它的进度', async () => {
      const repo = createRepository()
      await repo.save(book({ id: 'a' }))
      await repo.saveLocator('a', createLocator({ percent: 0.3 }, NOW))

      await repo.remove('a')
      await expect(repo.list()).resolves.toEqual([])
      await expect(repo.get('a')).resolves.toBeNull()
      await expect(repo.getLocator('a')).resolves.toBeNull()
    })

    it('删除不存在的书籍是幂等的', async () => {
      const repo = createRepository()
      await expect(repo.remove('ghost')).resolves.toBeUndefined()
    })

    it('并发保存不会丢失数据', async () => {
      const repo = createRepository()
      await Promise.all(
        Array.from({ length: 50 }, (_, index) =>
          repo.save({ ...book({ id: `book-${index}` }), addedAt: NOW + index })
        )
      )

      const list = await repo.list()
      expect(list).toHaveLength(50)
      expect(list[0]!.id).toBe('book-49')
    })
  })
}
