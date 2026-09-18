import { describe, expect, it, vi } from 'vitest'
import {
  AnnotationTransferFormatError,
  serializeAnnotationTransfer
} from '@core/adapters/annotationTransfer'
import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import { MAX_ANNOTATIONS_PER_BOOK, createBookmark, type Annotation } from '@core/domain/annotation'
import { importAnnotations, planAnnotationImport } from '@core/services/importAnnotations'

const NOW = 1_700_000_000_000

function bookmark(id: string, createdAt = NOW, bookId = 'book-1'): Annotation {
  return createBookmark({ id, bookId, cfi: `epubcfi(/6/${id})` }, createdAt)
}

/** 一份从 book-1 导出的合法文件，条目全在 book-1 名下。 */
function transfer(annotations: Annotation[], bookId = 'book-1'): string {
  return serializeAnnotationTransfer({ id: bookId, title: '三体' }, annotations, NOW)
}

describe('planAnnotationImport', () => {
  it('把文件里的条目一律重定向到目标书', () => {
    const plan = planAnnotationImport({
      existing: [],
      incoming: [bookmark('a', NOW, '另一本书'), bookmark('b', NOW, '第三本书')],
      targetBookId: 'book-2',
      capacity: 10
    })

    expect(plan.added).toBe(2)
    expect(plan.toInsert.map((item) => item.bookId)).toEqual(['book-2', 'book-2'])
  })

  it('与已有条目同 id 的算跳过，且不覆盖已有的那条', () => {
    const existing = [bookmark('a', NOW - 5000)]

    const plan = planAnnotationImport({
      existing,
      incoming: [bookmark('a', NOW)],
      targetBookId: 'book-1',
      capacity: 10
    })

    expect(plan).toMatchObject({ added: 0, skipped: 1, trimmed: 0 })
    expect(plan.toInsert).toEqual([])
  })

  it('文件里两条同 id 时只写一条，另一条算跳过', () => {
    // 重定向会把这两条压到同一个 storageKey，两条都写等于后写覆盖先写，
    // 但计数会报 2，界面就会说「新增 2 条」而磁盘上只有 1 条
    const plan = planAnnotationImport({
      existing: [],
      incoming: [bookmark('a', NOW, '另一本书'), bookmark('a', NOW - 1000, '第三本书')],
      targetBookId: 'book-2',
      capacity: 10
    })

    expect(plan).toMatchObject({ added: 1, skipped: 1, trimmed: 0 })
  })

  it('容量不够时按顺序截断，剩下的算 trimmed', () => {
    const plan = planAnnotationImport({
      existing: [],
      incoming: [bookmark('a', NOW - 1000), bookmark('b', NOW - 2000), bookmark('c', NOW - 3000)],
      targetBookId: 'book-1',
      capacity: 2
    })

    expect(plan.toInsert.map((item) => item.id)).toEqual(['a', 'b'])
    expect(plan).toMatchObject({ added: 2, skipped: 0, trimmed: 1 })
  })

  it('重复条目不占容量名额：先按 id 去重再截断', () => {
    const plan = planAnnotationImport({
      existing: [],
      incoming: [bookmark('a', NOW - 1000), bookmark('a', NOW - 2000), bookmark('b', NOW - 3000)],
      targetBookId: 'book-1',
      capacity: 1
    })

    // 若先截断，a 的第二条会占掉唯一的名额，b 反而进不来
    expect(plan.toInsert.map((item) => item.id)).toEqual(['a'])
    expect(plan).toMatchObject({ added: 1, skipped: 1, trimmed: 1 })
  })

  it('容量为 0 时两条同 id 只记一次 trimmed', () => {
    const plan = planAnnotationImport({
      existing: [],
      incoming: [bookmark('a', NOW - 1000), bookmark('a', NOW - 2000)],
      targetBookId: 'book-1',
      capacity: 0
    })

    expect(plan.toInsert).toEqual([])
    expect(plan).toMatchObject({ added: 0, skipped: 1, trimmed: 1 })
  })

  it('同一批不同顺序得到同一结果', () => {
    const items = [bookmark('a', NOW - 1000), bookmark('b', NOW - 2000), bookmark('c', NOW - 3000)]

    const forward = planAnnotationImport({ existing: [], incoming: items, targetBookId: 'b1', capacity: 2 })
    const backward = planAnnotationImport({
      existing: [],
      incoming: [...items].reverse(),
      targetBookId: 'b1',
      capacity: 2
    })

    expect(forward).toEqual(backward)
  })

  it('空输入时三项都是 0', () => {
    expect(
      planAnnotationImport({ existing: [bookmark('a')], incoming: [], targetBookId: 'book-1', capacity: 5 })
    ).toMatchObject({ added: 0, skipped: 0, trimmed: 0 })
  })
})

describe('importAnnotations', () => {
  async function setup(seed: Annotation[] = []) {
    const repository = new InMemoryAnnotationRepository()
    if (seed.length > 0) await repository.saveMany(seed)
    return repository
  }

  it('把文件里的条目写进目标书，并回报各项计数', async () => {
    const repository = await setup([bookmark('existing', NOW - 9000)])

    const summary = await importAnnotations(
      transfer([bookmark('a', NOW - 1000), bookmark('existing', NOW - 2000)]),
      'book-1',
      { repository }
    )

    expect(summary).toEqual({ added: 1, skipped: 1, dropped: 0, trimmed: 0, fromOtherBook: false })
    await expect(repository.listByBook('book-1')).resolves.toHaveLength(2)
  })

  it('整批只写一次盘', async () => {
    const repository = await setup()
    const saveMany = vi.spyOn(repository, 'saveMany')

    await importAnnotations(
      transfer([bookmark('a', NOW - 1000), bookmark('b', NOW - 2000), bookmark('c', NOW - 3000)]),
      'book-1',
      { repository }
    )

    expect(saveMany).toHaveBeenCalledTimes(1)
    expect(saveMany.mock.calls[0]?.[0]).toHaveLength(3)
  })

  it('一条都写不进去时不写盘', async () => {
    const repository = await setup([bookmark('a')])
    const saveMany = vi.spyOn(repository, 'saveMany')

    const summary = await importAnnotations(transfer([bookmark('a', NOW - 1000)]), 'book-1', { repository })

    expect(summary).toMatchObject({ added: 0, skipped: 1 })
    expect(saveMany).not.toHaveBeenCalled()
  })

  it('导出自别的书时把条目归到这本书上，并标记来源不同', async () => {
    const repository = await setup()

    const summary = await importAnnotations(transfer([bookmark('a')], 'other-book'), 'book-1', { repository })

    expect(summary.fromOtherBook).toBe(true)
    const stored = await repository.listByBook('book-1')
    expect(stored.map((item) => item.bookId)).toEqual(['book-1'])
  })

  it('文件不合法时直接抛错，连存档都不去读', async () => {
    const repository = await setup()
    const listByBook = vi.spyOn(repository, 'listByBook')
    const saveMany = vi.spyOn(repository, 'saveMany')

    await expect(importAnnotations('{ 这不是 json', 'book-1', { repository })).rejects.toBeInstanceOf(
      AnnotationTransferFormatError
    )

    expect(listByBook).not.toHaveBeenCalled()
    expect(saveMany).not.toHaveBeenCalled()
  })

  it('坏条目按条丢弃并计数，好条目照常写入', async () => {
    const repository = await setup()
    const envelope = JSON.parse(transfer([bookmark('a')])) as { annotations: Record<string, unknown>[] }
    envelope.annotations.push({ ...envelope.annotations[0]!, cfi: '' })

    const summary = await importAnnotations(JSON.stringify(envelope), 'book-1', { repository })

    expect(summary).toMatchObject({ added: 1, dropped: 1 })
  })

  it('这本书已满时全部算 trimmed，一条都不写', async () => {
    const full = Array.from({ length: MAX_ANNOTATIONS_PER_BOOK }, (_, index) => bookmark(`old-${index}`, NOW - index))
    const repository = await setup(full)
    const saveMany = vi.spyOn(repository, 'saveMany')

    const summary = await importAnnotations(transfer([bookmark('a'), bookmark('b')]), 'book-1', { repository })

    expect(summary).toMatchObject({ added: 0, trimmed: 2 })
    expect(saveMany).not.toHaveBeenCalled()
    await expect(repository.listByBook('book-1')).resolves.toHaveLength(MAX_ANNOTATIONS_PER_BOOK)
  })

  it('还差几条就满时只写入放得下的那几条', async () => {
    const full = Array.from(
      { length: MAX_ANNOTATIONS_PER_BOOK - 1 },
      (_, index) => bookmark(`old-${index}`, NOW - index)
    )
    const repository = await setup(full)

    const summary = await importAnnotations(
      transfer([bookmark('a', NOW - 1000), bookmark('b', NOW - 2000)]),
      'book-1',
      { repository }
    )

    expect(summary).toMatchObject({ added: 1, trimmed: 1 })
    await expect(repository.listByBook('book-1')).resolves.toHaveLength(MAX_ANNOTATIONS_PER_BOOK)
  })
})
