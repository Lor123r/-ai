import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_ANNOTATIONS_PER_BOOK,
  compareAnnotationsForList,
  createBookmark,
  createHighlight,
  recolorHighlight,
  type Annotation,
  type HighlightAnnotation,
  type HighlightColor
} from '@core/domain/annotation'
import { useAnnotationRepository } from '@renderer/data/AnnotationRepositoryProvider'
import { useAnnotationTransfer } from '@renderer/data/AnnotationTransferProvider'
import type { ImportAnnotationsSummary } from '@core/ports/annotationTransfer'
import { ANNOTATION_EXPORT_BOUNDARY_MESSAGE, ANNOTATION_FILE_INVALID_MESSAGE } from '@shared/ipc'
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

/** 导出 / 导入的兜底文案。与读写分开，用户才知道是笔记出问题了还是文件出问题了。 */
export const ANNOTATION_EXPORT_FAILED_MESSAGE = '导出失败，请重试'
export const ANNOTATION_IMPORT_FAILED_MESSAGE = '导入失败，请重试'

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
  /** 这次运行有没有注解交换能力（浏览器预览没有）。没有时界面要隐藏导出导入入口。 */
  canTransfer: boolean
  /** 最近一次导出 / 导入的结果文案，与 failure 互不影响。 */
  transferResult: string | null
  addBookmark: (target: AnnotationTarget) => Promise<void>
  addHighlight: (target: HighlightTarget) => Promise<void>
  /** 换掉一条划线的配色。原地改同一条注解，id / createdAt 都不变。 */
  setHighlightColor: (annotation: HighlightAnnotation, color: HighlightColor) => Promise<void>
  removeAnnotation: (annotation: Annotation) => Promise<void>
  /** 导出这本书的全部注解。用户取消另存框时静默返回。 */
  exportAnnotations: () => Promise<void>
  /** 导入一份注解文件到这本书。只增不删，完成后自动重载列表。 */
  importAnnotations: () => Promise<void>
  /** 重新从存档载入本书注解，不清空当前列表。 */
  reload: () => Promise<void>
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
 * 把五段计数串成一句话，只留非零的部分。
 *
 * 「新增 0 条；跳过 0 条；丢弃 0 条」这种逐项罗列等于什么都没说，用户还得自己从一串
 * 零里读出「这文件里没有一条能用的」。全为零时就给一句明确的话。
 *
 * 四个数各自对应完全相反的处置动作（跳过＝文件对、本机已有；丢弃＝文件有坏条目；
 * 达到上限＝书架满了，得先删几条），所以混成一句「丢弃 N 条」是不行的。
 */
function describeImport(summary: ImportAnnotationsSummary): string {
  const parts: string[] = []

  if (summary.added > 0) parts.push(`新增 ${summary.added} 条`)
  if (summary.skipped > 0) parts.push(`跳过 ${summary.skipped} 条（本机已有）`)
  if (summary.dropped > 0) parts.push(`丢弃 ${summary.dropped} 条（数据不合法）`)
  if (summary.trimmed > 0) parts.push(`${summary.trimmed} 条因达到上限未导入`)

  const base = parts.length > 0 ? parts.join('；') : '文件里没有可导入的注解'
  return summary.fromOtherBook ? `${base}。这份文件导出自另一本书` : base
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
  const transfer = useAnnotationTransfer()
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [status, setStatus] = useState<AnnotationListStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [transferResult, setTransferResult] = useState<string | null>(null)
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

  /**
   * 从存档载入本书的注解。切书与导入后的重载走同一条路径，只在列表处理上分岔。
   *
   * `clear` 为真要先清空：换书时留着上一本的列表会让新书的界面列出别的书的书签。
   * 导入后的重载则不能清 —— 那会让抽屉闪一下「还没有书签或划线」，而这句话在那一刻
   * 是假的。
   */
  const load = useCallback(
    async ({ clear }: { clear: boolean }) => {
      const requestId = latestRequest.current + 1
      latestRequest.current = requestId

      if (clear) {
        applyList([])
        setStatus('loading')
      }
      setError(null)

      try {
        const list = await repository.listByBook(bookId)
        if (!mounted.current || requestId !== latestRequest.current) return

        applyList([...list].sort(compareAnnotationsForList))
        setError(null)
        setStatus('ready')
      } catch {
        if (!mounted.current || requestId !== latestRequest.current) return

        setError(ANNOTATIONS_UNAVAILABLE_MESSAGE)
        setStatus('error')
      }
    },
    [applyList, bookId, repository]
  )

  useEffect(() => {
    setFailure(null)
    setTransferResult(null)
    void load({ clear: true })

    return () => {
      latestRequest.current += 1
    }
  }, [load])

  const reload = useCallback(() => load({ clear: false }), [load])

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

  /**
   * 乐观改色。与 removeAnnotation 同构：先落本地列表再落盘，失败恢复整份快照。
   *
   * 做的是**原地改**（recolorHighlight）而不是「删了重划」：图层按 id 记账、epub.js 的
   * marks 表按 cfi 索引，同一 cfi 上出现两条 id 不同的划线会留下清不掉的孤儿 mark。
   * 因为 id 与 createdAt 都没动，列表顺序不会变，这里**不需要**再 sort 一次。
   */
  const setHighlightColor = useCallback(
    async (annotation: HighlightAnnotation, color: HighlightColor) => {
      // 点到的就是当前颜色：没有改动就不落盘。与仓储里「删除不存在的 id 不写盘」
      // 同一条约定 —— 不要把一次无意义的点击变成一次 IPC 加一次文件写。
      if (annotation.color === color) return

      setFailure(null)
      const snapshot = current.current
      const updated = recolorHighlight(annotation, color, now())
      applyList(snapshot.map((item) => (item.id === updated.id ? updated : item)))

      try {
        await repository.save(updated)
      } catch (caught) {
        applyList(snapshot)
        setFailure(saveFailureMessage(caught))
      }
    },
    [applyList, now, repository]
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

  /**
   * 导出这本书的注解。
   *
   * 结果单独立一份状态，而不是复用 failure：成功后要能说出「导出了几条」，
   * 否则界面毫无反应，用户根本不知道文件到底存没存下来。
   */
  const exportAnnotations = useCallback(async () => {
    if (!transfer) return

    setFailure(null)
    setTransferResult(null)

    try {
      const summary = await transfer.exportBook(bookId)
      // 用户取消另存框：什么也不说，保持上一次的提示不变
      if (summary === null) return

      setTransferResult(`已导出 ${summary.count} 条注解`)
    } catch (caught) {
      // 目标落在应用数据目录里是唯一一种「重试一万次也没用」的失败，
      // 必须照原话说，好让用户去改路径而不是反复点导出
      setFailure(
        toMessage(caught).includes(ANNOTATION_EXPORT_BOUNDARY_MESSAGE)
          ? ANNOTATION_EXPORT_BOUNDARY_MESSAGE
          : ANNOTATION_EXPORT_FAILED_MESSAGE
      )
    }
  }, [bookId, transfer])

  const importAnnotations = useCallback(async () => {
    if (!transfer) return

    setFailure(null)
    setTransferResult(null)

    try {
      const summary = await transfer.importInto(bookId)
      if (summary === null) return

      setTransferResult(describeImport(summary))
      // 重载而不是把条目并进本地列表：主进程那边同时在按 id 去重、按容量截断，
      // 在渲染层照着推算一遍等于把同一套规则写两处，迟早走散。
      await reload()
    } catch (caught) {
      // 「文件挑错了」与「导入失败」分开说：前者重试没有意义，得回去换文件
      setFailure(
        toMessage(caught).includes(ANNOTATION_FILE_INVALID_MESSAGE)
          ? ANNOTATION_FILE_INVALID_MESSAGE
          : ANNOTATION_IMPORT_FAILED_MESSAGE
      )
    }
  }, [bookId, reload, transfer])

  return {
    annotations,
    status,
    error,
    failure,
    canTransfer: transfer !== null,
    transferResult,
    addBookmark,
    addHighlight,
    setHighlightColor,
    removeAnnotation,
    exportAnnotations,
    importAnnotations,
    reload
  }
}
