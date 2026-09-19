import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShelfEntry } from '@core/domain/shelfView'
import { useBookRepository } from '../data/BookRepositoryProvider'

export type { ShelfEntry }

export type ShelfStatus = 'loading' | 'ready' | 'error'

export interface UseBooksResult {
  entries: ShelfEntry[]
  status: ShelfStatus
  error: string | null
  reload: () => Promise<void>
  removeBook: (id: string) => Promise<void>
  markOpened: (id: string, openedAt?: number) => Promise<void>
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 书架数据源：把仓库里的书籍与阅读进度合并成可直接渲染的条目。
 * 用请求序号丢弃过期结果，避免快速切换书架时的竞态与卸载后写入。
 */
export function useBooks(): UseBooksResult {
  const repository = useBookRepository()
  const [entries, setEntries] = useState<ShelfEntry[]>([])
  const [status, setStatus] = useState<ShelfStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const latestRequest = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId

    try {
      const books = await repository.list()
      const locators = await Promise.all(books.map((book) => repository.getLocator(book.id)))
      if (!mounted.current || requestId !== latestRequest.current) return

      setEntries(books.map((book, index) => ({ book, locator: locators[index] ?? null })))
      setError(null)
      setStatus('ready')
    } catch (caught) {
      if (!mounted.current || requestId !== latestRequest.current) return

      setError(toMessage(caught))
      setStatus('error')
    }
  }, [repository])

  useEffect(() => {
    void reload()
    return () => {
      latestRequest.current += 1
    }
  }, [reload])

  const removeBook = useCallback(
    async (id: string) => {
      await repository.remove(id)
      await reload()
    },
    [repository, reload]
  )

  const markOpened = useCallback(
    async (id: string, openedAt: number = Date.now()) => {
      await repository.markOpened(id, openedAt)
      await reload()
    },
    [repository, reload]
  )

  return { entries, status, error, reload, removeBook, markOpened }
}
