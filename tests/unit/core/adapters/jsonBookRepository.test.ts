import { describe, expect, it } from 'vitest'
import { JsonBookRepository } from '@core/adapters/jsonBookRepository'
import { InMemoryTextStore } from '@core/adapters/inMemoryTextStore'
import { isCorruptLibraryError } from '@core/adapters/librarySnapshot'
import { createBook } from '@core/domain/book'
import { createLocator } from '@core/domain/progress'
import { describeBookRepositoryContract } from '../contracts/bookRepositoryContract'

describeBookRepositoryContract('JsonBookRepository', () => new JsonBookRepository(new InMemoryTextStore()))

const NOW = 1_700_000_000_000

function sampleBook(id: string, addedAt = NOW) {
  return {
    ...createBook({ id, title: `书名 ${id}`, format: 'epub', filePath: `C:/lib/${id}.epub`, fileSize: 512 }),
    addedAt
  }
}

describe('JsonBookRepository 持久化', () => {
  it('第一次读取时才真正读盘（空文件视为空书库）', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)

    await expect(repo.list()).resolves.toEqual([])
    expect(store.writes).toEqual([])
  })

  it('新建实例能从同一份文本还原书籍与进度', async () => {
    const store = new InMemoryTextStore()
    const first = new JsonBookRepository(store)
    await first.save(sampleBook('a'))
    await first.saveLocator('a', createLocator({ cfi: 'epubcfi(/6/4!/4/2)', percent: 0.37, chapterIndex: 2 }, NOW))

    const second = new JsonBookRepository(store)
    await expect(second.get('a')).resolves.toEqual(sampleBook('a'))
    await expect(second.getLocator('a')).resolves.toEqual(
      createLocator({ cfi: 'epubcfi(/6/4!/4/2)', percent: 0.37, chapterIndex: 2 }, NOW)
    )
  })

  it('落盘内容是合法 JSON 且带格式版本号，便于将来迁移', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)
    await repo.save(sampleBook('a'))

    const parsed = JSON.parse(store.current ?? '') as { version: number; books: unknown[] }
    expect(parsed.version).toBe(1)
    expect(parsed.books).toHaveLength(1)
  })

  it('磁盘上的存档损坏时 load 抛出可识别的 LibraryCorruptError', async () => {
    const store = new InMemoryTextStore('{ 这不是 JSON')

    await expect(new JsonBookRepository(store).load()).rejects.toSatisfy(isCorruptLibraryError)
  })

  it('单条记录损坏只丢弃该条，其余书籍照常读出', async () => {
    const store = new InMemoryTextStore(
      JSON.stringify({
        version: 1,
        books: [sampleBook('good'), { id: 'broken', format: 'epub' }],
        locators: {}
      })
    )

    await expect(new JsonBookRepository(store).list()).resolves.toEqual([sampleBook('good')])
  })

  it('写盘失败时错误会向上抛出，而不是被静默吞掉', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)
    store.failWith(new Error('磁盘已满'))

    await expect(repo.save(sampleBook('a'))).rejects.toThrow('磁盘已满')
  })

  it('一次写盘失败后仍可继续使用（锁不会卡死）', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)
    store.failWith(new Error('磁盘已满'))
    await expect(repo.save(sampleBook('a'))).rejects.toThrow('磁盘已满')

    store.failWith(null)
    await repo.save(sampleBook('a'))
    await expect(repo.list()).resolves.toEqual([sampleBook('a')])
  })

  it('多个实例并发保存不会互相覆盖（串行化写入）', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)

    await Promise.all([repo.save(sampleBook('a')), repo.save(sampleBook('b')), repo.save(sampleBook('c'))])

    const ids = (await repo.list()).map((item) => item.id)
    expect(ids.sort()).toEqual(['a', 'b', 'c'])
    expect(JSON.parse(store.current ?? '').books).toHaveLength(3)
  })
})

describe('JsonBookRepository 落盘失败时回滚内存', () => {
  it('save 落盘失败后内存里不会留下一本不存在的书', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)
    store.failWith(new Error('磁盘已满'))

    await expect(repo.save(sampleBook('a'))).rejects.toThrow('磁盘已满')
    store.failWith(null)

    // 内存不回滚就会读到「重启后就消失」的书；调用方据此删掉磁盘文件，
    // 反而会留下文件没了、书又回来的坏状态
    await expect(repo.list()).resolves.toEqual([])
    await expect(repo.get('a')).resolves.toBeNull()
  })

  it('remove 落盘失败后书与进度都还在', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)
    await repo.save(sampleBook('a'))
    await repo.saveLocator('a', createLocator({ cfi: 'epubcfi(/6/4!/4/2)', percent: 0.5, chapterIndex: 1 }, NOW))
    store.failWith(new Error('磁盘已满'))

    await expect(repo.remove('a')).rejects.toThrow('磁盘已满')
    store.failWith(null)

    await expect(repo.get('a')).resolves.toEqual(sampleBook('a'))
    await expect(repo.getLocator('a')).resolves.not.toBeNull()
  })

  it('saveLocator 落盘失败后进度不会假装已经存下', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)
    await repo.save(sampleBook('a'))
    store.failWith(new Error('磁盘已满'))

    await expect(
      repo.saveLocator('a', createLocator({ cfi: 'epubcfi(/6/4!/4/2)', percent: 0.5, chapterIndex: 1 }, NOW))
    ).rejects.toThrow('磁盘已满')
    store.failWith(null)

    // 认了这份进度会让人停在没存住的那一页
    await expect(repo.getLocator('a')).resolves.toBeNull()
  })

  it('markOpened 落盘失败后打开时间保持原样', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)
    await repo.save(sampleBook('a'))
    store.failWith(new Error('磁盘已满'))

    await expect(repo.markOpened('a', NOW + 1000)).rejects.toThrow('磁盘已满')
    store.failWith(null)

    await expect(repo.get('a')).resolves.toEqual(sampleBook('a'))
  })

  it('回滚只作废失败的那一次，之后的写入照常生效', async () => {
    const store = new InMemoryTextStore()
    const repo = new JsonBookRepository(store)
    await repo.save(sampleBook('a'))
    store.failWith(new Error('磁盘已满'))
    await expect(repo.save(sampleBook('b'))).rejects.toThrow('磁盘已满')

    store.failWith(null)
    await repo.save(sampleBook('b'))

    const ids = (await repo.list()).map((book) => book.id)
    expect(ids).toEqual(['a', 'b'])
  })
})
