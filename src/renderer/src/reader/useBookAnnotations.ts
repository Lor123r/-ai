import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_ANNOTATIONS_PER_BOOK,
  compareAnnotationsForList,
  createBookmark,
  createHighlight,
  type Annotation,
  type HighlightColor
} from '@core/domain/annotation'
import { useAnnotationRepository } from '@renderer/data/AnnotationRepositoryProvider'
import { createAnnotationId } from './annotationId'

export type AnnotationListStatus = 'loading' | 'ready' | 'error'

/**
 * 存档读不出来时的文案。不含 IPC 抛出来的原文：那边会包成
 * `Error invoking remote method 'annotations:listByBook': Error: ...`，既难读也泄漏内部细节。
 */
export const ANNOTATIONS_UNAVAILABLE_MESSAGE = '注解功能本次不可用'

/** 写失败的兜底文案；与上面同理，绝不回声 IPC message。 */
export const ANNOTATION_SAVE_FAILED_MESSAGE = '保存失败，请重试'

/** 上限打满要单独说清楚，否则用户只会看到一句「保存失败」而无从下手。 */
export const ANNOTATION_LIMIT_MESSAGE = `这本书的注解已达上限（${MAX_ANNOTATIONS_PER_BOOK} 条）`

/**
 * 主进程仓储打满上限时抛出的原文（超过这个数才允许再存一条）。
 * 只做包含匹配：经过 IPC 之后 message 外面还会被套一层前缀。
 */
const LIMIT_ERROR_FRAGMENT = '注解数量已达上限'

/** 注解的落点。cfi 是唯一必填项，href / percent 只用于列表展示。 */
export interface AnnotationTarget {
  cfi: string
  chapterHref?: string
  percent?: number
}

export interface HighlightTarget extends AnnotationTarget {
  excerpt?: string
  color?: HighlightColor
}

export interface UseBookAnnotationsOptions {
  bookId: string
  /** 注入时钟，让测试能固定 createdAt（排序会用到它）。 */
  now: () => number
  /** 注入 id 生成，测试里可换成确定值。 */
  createId?: () => string
}

export interface UseBookAnnotationsResult {
  annotations: Annotation[]
  /** 列表载入状态。error 时不要显示「还没有书签或划线」，那是一句假话。 */
  status: AnnotationListStatus
  /** 读不到存档时的固定文案，界面上要据此禁用标注入口。 */
  error: string | null
  /** 最近一次写失败的文案；每次新的写操作开始时会清回 null。 */
  failure: string | null
  addBookmark: (target: AnnotationTarget) => Promise<void>
  addHighlight: (target: HighlightTarget) => Promise<void>
  removeAnnotation: (annotation: Annotation) => Promise<void>
}

function toMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

function saveFailureMessage(caught: unknown): string {
  return toMessage(caught).includes(LIMIT_ERROR_FRAGMENT)
    ? ANNOTATION_LIMIT_MESSAGE
    : ANNOTATION_SAVE_FAILED_MESSAGE
}

/**
 * 一本书的注解数据源。
 *
 * 读取用请求序号丢弃过期结果（快速切书时的竞态与卸载后写入都靠它挡住），
 * 写入走乐观更新：先落本地列表再落盘，失败则恢复**整份**旧数组。
 * 不能只把最后一条 pop 掉 —— 两次操作并发时 pop 掉的可能是另一条。
 */
export function useBookAnnotations(options: UseBookAnnotationsOptions): UseBookAnnotationsResult {
  const { bookId, now, createId = createAnnotationId } = options
  const repository = useAnnotationRepository()
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [status, setStatus] = useState<AnnotationListStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const latestRequest = useRef(0)
  const mounted = useRef(true)
  /** 本地列表的同步镜像，用作乐观写入失败时的回滚快照。 */
  const current = useRef<Annotation[]>([])

  const applyList = useCallback((next: Annotation[]) => {
    current.current = next
    setAnnotations(next)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId

    // 换书时必须先清空：留着上一本的列表会让新书的界面列出别的书的书签
    applyList([])
    setStatus('loading')
    setError(null)
    setFailure(null)

    void repository
      .listByBook(bookId)
      .then((list) => {
        if (!mounted.current || requestId !== latestRequest.current) return

        applyList([...list].sort(compareAnnotationsForList))
        setError(null)
        setStatus('ready')
      })
      .catch(() => {
        if (!mounted.current || requestId !== latestRequest.current) return

        setError(ANNOTATIONS_UNAVAILABLE_MESSAGE)
        setStatus('error')
      })

    return () => {
      latestRequest.current += 1
    }
  }, [bookId, repository, applyList])

  /**
   * 乐观新增。整段（构造 + 写本地列表 + 落盘）包在同一个 try/catch 里：
   * core 的工厂是 throw 语义（cfi 为空、id 非法都会抛），save 本身也会 reject
   * （上限打满、IPC 断、降级仓储），两者都落到同一句失败文案上。
   * 构造失败时列表还没动过，回滚到快照等于空操作。
   */
  const commitNew = useCallback(
    async (build: () => Annotation) => {
      setFailure(null)
      const snapshot = current.current

      try {
        const created = build()
        applyList([...snapshot, created].sort(compareAnnotationsForList))
        await repository.save(created)
      } catch (caught) {
        applyList(snapshot)
        setFailure(saveFailureMessage(caught))
      }
    },
    [applyList, repository]
  )

  const addBookmark = useCallback(
    (target: AnnotationTarget) =>
      commitNew(() => createBookmark({ id: createId(), bookId, ...target }, now())),
    [commitNew, createId, bookId, now]
  )

  const addHighlight = useCallback(
    (target: HighlightTarget) =>
      commitNew(() => createHighlight({ id: createId(), bookId, ...target }, now())),
    [commitNew, createId, bookId, now]
  )

  const removeAnnotation = useCallback(
    async (annotation: Annotation) => {
      setFailure(null)
      const snapshot = current.current
      applyList(snapshot.filter((item) => item.id !== annotation.id))

      try {
        await repository.remove(bookId, annotation.id)
      } catch (caught) {
        // 失败就把它原样放回去，顺序仍由 compareAnnotationsForList 统一决定
        applyList(snapshot)
        setFailure(saveFailureMessage(caught))
      }
    },
    [applyList, bookId, repository]
  )

  return { annotations, status, error, failure, addBookmark, addHighlight, removeAnnotation }
}
