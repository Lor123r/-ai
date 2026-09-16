import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import {
  MAX_ANNOTATIONS_PER_BOOK,
  createBookmark,
  type Annotation
} from '@core/domain/annotation'
import { describeAnnotationRepositoryContract } from '../contracts/annotationRepositoryContract'
import { describe, expect, it } from 'vitest'

const NOW = 1_700_000_000_000

function bookmark(id: string, createdAt = NOW): Annotation {
  return createBookmark({ id, bookId: 'b1', cfi: 'epubcfi(/6/4!/4/2/2)' }, createdAt)
}

describeAnnotationRepositoryContract('InMemoryAnnotationRepository', () => new InMemoryAnnotationRepository())

describe('InMemoryAnnotationRepository 上限', () => {
  it('达到每本书的上限后新增会抛错，但覆盖已有条目仍然允许', async () => {
    const repo = new InMemoryAnnotationRepository()
    for (let index = 0; index < MAX_ANNOTATIONS_PER_BOOK; index += 1) {
      await repo.save(bookmark(`a-${index}`, NOW + index))
    }

    await expect(repo.save(bookmark('a-overflow'))).rejects.toThrow('注解数量已达上限')
    await expect(repo.save(bookmark('a-0', NOW + 9999))).resolves.toBeUndefined()

    await expect(repo.listByBook('b1')).resolves.toHaveLength(MAX_ANNOTATIONS_PER_BOOK)
  })

  it('上限按书计算，一本书满了不影响另一本书', async () => {
    const repo = new InMemoryAnnotationRepository()
    for (let index = 0; index < MAX_ANNOTATIONS_PER_BOOK; index += 1) {
      await repo.save(bookmark(`a-${index}`, NOW + index))
    }

    await expect(
      repo.save(createBookmark({ id: 'other', bookId: 'b2', cfi: 'epubcfi(/6/4!/4/2/2)' }))
    ).resolves.toBeUndefined()
  })
})
