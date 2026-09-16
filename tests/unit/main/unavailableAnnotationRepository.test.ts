import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import { createBookmark, createHighlight } from '@core/domain/annotation'
import {
  ANNOTATIONS_UNAVAILABLE_MESSAGE,
  UnavailableAnnotationRepository
} from '../../../src/main/storage/unavailableAnnotationRepository'
import { describe, expect, it } from 'vitest'

const NOW = 1_700_000_000_000

function sampleBookmark() {
  return createBookmark({ id: 'a1', bookId: 'b1', cfi: 'epubcfi(/6/4!/4/2/2)', note: '笔记' }, NOW)
}

function sampleHighlight() {
  return createHighlight(
    {
      id: 'a2',
      bookId: 'b1',
      cfi: 'epubcfi(/6/4!/4/2/2,/1:0,/1:8)',
      excerpt: '一段被划住的原文',
      color: 'yellow',
      note: ''
    },
    NOW
  )
}

describe('UnavailableAnnotationRepository', () => {
  it('四个数据方法一律失败，且文案完全一致（渲染层只需要一套固定文案）', async () => {
    const repository = new UnavailableAnnotationRepository()

    for (const call of [
      () => repository.listByBook('b1'),
      () => repository.save(sampleBookmark()),
      () => repository.save(sampleHighlight()),
      () => repository.remove('b1', 'a1'),
      () => repository.removeByBook('b1')
    ]) {
      await expect(call()).rejects.toThrow(ANNOTATIONS_UNAVAILABLE_MESSAGE)
    }
  })

  it('读也失败：返回空数组会让界面谎称「这本书还没有注解」', async () => {
    const repository = new UnavailableAnnotationRepository()

    // 内存实现在这条路径上会给出 []，于是一个读不出存档的会话看起来像「新书」
    await expect(new InMemoryAnnotationRepository().listByBook('b1')).resolves.toEqual([])
    await expect(repository.listByBook('b1')).rejects.toThrow(ANNOTATIONS_UNAVAILABLE_MESSAGE)
  })

  it('load() 保持 resolve：启动链上不该再冒出一个可能被忽略的 rejection', async () => {
    const repository = new UnavailableAnnotationRepository()

    await expect(repository.load()).resolves.toBeUndefined()
    // 失败之后依然如此，不会因为「试过一次」就改变形态
    await expect(repository.load()).resolves.toBeUndefined()
  })

  it('失败是可重复的：不会第一次炸掉之后就悄悄变成能写', async () => {
    const repository = new UnavailableAnnotationRepository()

    await expect(repository.save(sampleBookmark())).rejects.toThrow(ANNOTATIONS_UNAVAILABLE_MESSAGE)
    await expect(repository.save(sampleBookmark())).rejects.toThrow(ANNOTATIONS_UNAVAILABLE_MESSAGE)
    await expect(repository.listByBook('b1')).rejects.toThrow(ANNOTATIONS_UNAVAILABLE_MESSAGE)
  })
})
