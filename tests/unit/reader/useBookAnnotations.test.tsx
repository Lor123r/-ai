import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import { createBookmark, type Annotation } from '@core/domain/annotation'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import { AnnotationRepositoryProvider } from '@renderer/data/AnnotationRepositoryProvider'
import {
  ANNOTATIONS_UNAVAILABLE_MESSAGE,
  ANNOTATION_LIMIT_MESSAGE,
  ANNOTATION_SAVE_FAILED_MESSAGE,
  useBookAnnotations
} from '@renderer/reader/useBookAnnotations'

/** 固定时钟：所有注解的 createdAt 相同，列表顺序就只由 id 决定，断言不依赖真实时间。 */
function frozenClock(): () => number {
  return () => 0
}

/** 每次读时间都往后走，用来验证列表按 createdAt 降序。 */
function tickingClock(stepMs = 1000): () => number {
  let value = 0
  return () => (value += stepMs)
}

function wrapper(repository: AnnotationRepository) {
  return function Wrapper({ children }: { children: ReactNode }): React.JSX.Element {
    return <AnnotationRepositoryProvider repository={repository}>{children}</AnnotationRepositoryProvider>
  }
}

/** 一个只在指定动作上失败的仓储，其余行为与内存实现一致。 */
function failingRepository(error: Error, action: 'save' | 'remove'): AnnotationRepository {
  const inner = new InMemoryAnnotationRepository()

  return {
    load: () => inner.load(),
    listByBook: (bookId) => inner.listByBook(bookId),
    save: action === 'save' ? async () => Promise.reject(error) : (annotation) => inner.save(annotation),
    remove: action === 'remove' ? async () => Promise.reject(error) : (bookId, id) => inner.remove(bookId, id),
    removeByBook: (bookId) => inner.removeByBook(bookId)
  }
}

function bookmark(id: string, bookId = 'book-1'): Annotation {
  return createBookmark({ id, bookId, cfi: `epubcfi(/6/${id})` }, 0)
}

describe('useBookAnnotations', () => {
  it('载入完成前是 loading，完成后给出列表', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(bookmark('a'))
    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock() }),
      { wrapper: wrapper(repository) }
    )

    expect(result.current.status).toBe('loading')

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.annotations.map((item) => item.id)).toEqual(['a'])
    expect(result.current.error).toBeNull()
  })

  it('按 createdAt 降序给出列表，不依赖仓储的返回顺序', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(createBookmark({ id: 'old', bookId: 'book-1', cfi: 'epubcfi(/6/2)' }, 0))
    await repository.save(createBookmark({ id: 'new', bookId: 'book-1', cfi: 'epubcfi(/6/4)' }, 5000))

    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock() }),
      { wrapper: wrapper(repository) }
    )

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.annotations.map((item) => item.id)).toEqual(['new', 'old'])
  })

  it('读不到存档时给固定文案，而不是假装「没有注解」', async () => {
    const repository = failingRepository(new Error('存档损坏'), 'save')
    repository.listByBook = async () => Promise.reject(new Error('存档损坏'))

    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock() }),
      { wrapper: wrapper(repository) }
    )

    await waitFor(() => {
      expect(result.current.status).toBe('error')
    })
    expect(result.current.error).toBe(ANNOTATIONS_UNAVAILABLE_MESSAGE)
    expect(result.current.annotations).toEqual([])
  })

  it('新增书签先乐观落进列表，再落盘', async () => {
    const repository = new InMemoryAnnotationRepository()
    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock(), createId: () => 'id-1' }),
      { wrapper: wrapper(repository) }
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await act(async () => {
      await result.current.addBookmark({ cfi: 'epubcfi(/6/8)', chapterHref: 'ch1.xhtml', percent: 0.4 })
    })

    expect(result.current.annotations).toHaveLength(1)
    expect(result.current.annotations[0]).toMatchObject({
      id: 'id-1',
      kind: 'bookmark',
      bookId: 'book-1',
      cfi: 'epubcfi(/6/8)',
      chapterHref: 'ch1.xhtml',
      percent: 0.4
    })
    await expect(repository.listByBook('book-1')).resolves.toHaveLength(1)
  })

  it('落盘失败时回滚整份列表并给出失败文案', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(bookmark('a'))
    const failing = failingRepository(new Error('磁盘满了'), 'save')
    failing.listByBook = (bookId) => repository.listByBook(bookId)

    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock(), createId: () => 'id-1' }),
      { wrapper: wrapper(failing) }
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await act(async () => {
      await result.current.addBookmark({ cfi: 'epubcfi(/6/8)' })
    })

    expect(result.current.annotations.map((item) => item.id)).toEqual(['a'])
    expect(result.current.failure).toBe(ANNOTATION_SAVE_FAILED_MESSAGE)
  })

  it('打满上限时单独给出上限文案', async () => {
    const repository = failingRepository(new Error('注解数量已达上限'), 'save')
    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock() }),
      { wrapper: wrapper(repository) }
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await act(async () => {
      await result.current.addBookmark({ cfi: 'epubcfi(/6/8)' })
    })

    expect(result.current.failure).toBe(ANNOTATION_LIMIT_MESSAGE)
    expect(result.current.annotations).toEqual([])
  })

  it('经过 IPC 套了前缀的上限错误同样认得出来', async () => {
    const repository = failingRepository(
      new Error("Error invoking remote method 'annotations:save': Error: 注解数量已达上限"),
      'save'
    )
    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock() }),
      { wrapper: wrapper(repository) }
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await act(async () => {
      await result.current.addBookmark({ cfi: 'epubcfi(/6/8)' })
    })

    expect(result.current.failure).toBe(ANNOTATION_LIMIT_MESSAGE)
  })

  it('cfi 为空时构造就会抛，列表不动、只给失败文案', async () => {
    const repository = new InMemoryAnnotationRepository()
    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock() }),
      { wrapper: wrapper(repository) }
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await act(async () => {
      await result.current.addBookmark({ cfi: '' })
    })

    expect(result.current.annotations).toEqual([])
    expect(result.current.failure).toBe(ANNOTATION_SAVE_FAILED_MESSAGE)
  })

  it('新增划线把摘录与配色一起存下', async () => {
    const repository = new InMemoryAnnotationRepository()
    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: tickingClock(), createId: () => 'hl-1' }),
      { wrapper: wrapper(repository) }
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await act(async () => {
      await result.current.addHighlight({
        cfi: 'epubcfi(/6/8)',
        excerpt: '  一句摘录  ',
        color: 'blue',
        percent: 0.6
      })
    })

    await expect(repository.listByBook('book-1')).resolves.toMatchObject([
      { id: 'hl-1', kind: 'highlight', excerpt: '一句摘录', color: 'blue', percent: 0.6 }
    ])
  })

  it('删除先乐观移除，落盘失败再整份放回来', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(bookmark('a'))
    const failing = failingRepository(new Error('IPC 断了'), 'remove')
    failing.listByBook = (bookId) => repository.listByBook(bookId)

    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock() }),
      { wrapper: wrapper(failing) }
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    const target = result.current.annotations[0]

    await act(async () => {
      await result.current.removeAnnotation(target)
    })

    expect(result.current.annotations.map((item) => item.id)).toEqual(['a'])
    expect(result.current.failure).toBe(ANNOTATION_SAVE_FAILED_MESSAGE)
  })

  it('删除成功后列表里就没有它了', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(bookmark('a'))
    await repository.save(bookmark('b'))
    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock() }),
      { wrapper: wrapper(repository) }
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await act(async () => {
      await result.current.removeAnnotation(result.current.annotations.find((item) => item.id === 'a')!)
    })

    expect(result.current.annotations.map((item) => item.id)).toEqual(['b'])
    await expect(repository.listByBook('book-1')).resolves.toHaveLength(1)
  })

  it('新的写操作会清掉上一次的失败文案', async () => {
    const repository = failingRepository(new Error('磁盘满了'), 'save')
    const { result } = renderHook(
      () => useBookAnnotations({ bookId: 'book-1', now: frozenClock(), createId: () => 'id-1' }),
      { wrapper: wrapper(repository) }
    )
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })

    await act(async () => {
      await result.current.addBookmark({ cfi: 'epubcfi(/6/8)' })
    })
    expect(result.current.failure).toBe(ANNOTATION_SAVE_FAILED_MESSAGE)

    await act(async () => {
      await result.current.removeAnnotation(bookmark('gone'))
    })
    expect(result.current.failure).toBeNull()
  })

  it('换书时先清空列表再重新载入', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(bookmark('a', 'book-1'))
    await repository.save(bookmark('z', 'book-2'))

    const { result, rerender } = renderHook(
      ({ bookId }: { bookId: string }) => useBookAnnotations({ bookId, now: frozenClock() }),
      { wrapper: wrapper(repository), initialProps: { bookId: 'book-1' } }
    )
    await waitFor(() => {
      expect(result.current.annotations.map((item) => item.id)).toEqual(['a'])
    })

    rerender({ bookId: 'book-2' })

    await waitFor(() => {
      expect(result.current.annotations.map((item) => item.id)).toEqual(['z'])
    })
  })

  it('载入慢的旧请求不会覆盖新书的结果', async () => {
    const repository = new InMemoryAnnotationRepository()
    await repository.save(bookmark('a', 'book-1'))
    await repository.save(bookmark('z', 'book-2'))

    let releaseFirst: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve))
    const slow: AnnotationRepository = {
      load: () => repository.load(),
      listByBook: async (bookId) => {
        if (bookId === 'book-1') await gate
        return repository.listByBook(bookId)
      },
      save: (annotation) => repository.save(annotation),
      remove: (bookId, id) => repository.remove(bookId, id),
      removeByBook: (bookId) => repository.removeByBook(bookId)
    }

    const { result, rerender } = renderHook(
      ({ bookId }: { bookId: string }) => useBookAnnotations({ bookId, now: frozenClock() }),
      { wrapper: wrapper(slow), initialProps: { bookId: 'book-1' } }
    )
    rerender({ bookId: 'book-2' })

    await waitFor(() => {
      expect(result.current.annotations.map((item) => item.id)).toEqual(['z'])
    })

    releaseFirst()
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.annotations.map((item) => item.id)).toEqual(['z'])
  })
})
