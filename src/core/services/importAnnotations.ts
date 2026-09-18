import { MAX_ANNOTATIONS_PER_BOOK, compareAnnotationsForList, type Annotation } from '../domain/annotation'
import { parseAnnotationTransfer } from '../adapters/annotationTransfer'
import type { AnnotationRepository } from '../ports/annotationRepository'
import type { ImportAnnotationsSummary } from '../ports/annotationTransfer'

export interface AnnotationImportPlan {
  /** 真正要交给 saveMany 的条目，已重定向、已去重、已按容量截断。 */
  toInsert: Annotation[]
  added: number
  skipped: number
  trimmed: number
}

export interface PlanAnnotationImportInput {
  existing: readonly Annotation[]
  incoming: readonly Annotation[]
  targetBookId: string
  /** 目标书还能再放多少条。 */
  capacity: number
}

/**
 * 算出这次导入到底要写哪几条。
 *
 * 三步的顺序不能动：
 *
 * ① 先把每一条重定向到 targetBookId。文件里的 bookId 是导出时那本书的（内容是 sha256，
 *    同一个 EPUB 只要重新压过就变），照原样写会把注解落进一份没有任何界面能列出来的
 *    孤儿存档 —— 用户以为导入成功了，实际什么也没发生。
 *
 * ② 重定向之后再按 id 去重。文件里混着多本书的条目时，重定向会把两条同 id 压到同一个
 *    storageKey（`${bookId}\u0000${id}`），后写覆盖先写，而计数仍按两条上报 ——
 *    界面说「新增 2 条」，磁盘上只有 1 条。先按已有 id 去重只能挡住一半。
 *
 * ③ 最后才按容量截断。重复条目不该占用名额，所以这一步必须排在去重之后。
 *
 * 先排序再遍历：同一份文件无论条目顺序如何，保留下来的是同一批（导入结果可复现）。
 */
export function planAnnotationImport(input: PlanAnnotationImportInput): AnnotationImportPlan {
  const existingIds = new Set(input.existing.map((annotation) => annotation.id))
  const seen = new Set<string>()
  const toInsert: Annotation[] = []
  let skipped = 0
  let trimmed = 0

  for (const incoming of [...input.incoming].sort(compareAnnotationsForList)) {
    const annotation: Annotation = { ...incoming, bookId: input.targetBookId }

    if (existingIds.has(annotation.id) || seen.has(annotation.id)) {
      skipped += 1
      continue
    }

    // 先记入 seen 再判容量：否则文件里两条同 id 的条目会各自被记一次 trimmed，
    // 把「有多少条不同的注解没进来」报大
    seen.add(annotation.id)
    if (toInsert.length >= input.capacity) {
      trimmed += 1
      continue
    }

    toInsert.push(annotation)
  }

  return { toInsert, added: toInsert.length, skipped, trimmed }
}

export interface ImportAnnotationsDeps {
  repository: AnnotationRepository
  now?: () => number
}

/**
 * 把一份交换文件的内容并进这本书。只增不删 —— 整个功能里没有任何删除语义，
 * 一次误操作不至于清空用户的笔记，而且这正是「导入」相对「恢复备份」的意义所在。
 */
export async function importAnnotations(
  text: string,
  targetBookId: string,
  deps: ImportAnnotationsDeps
): Promise<ImportAnnotationsSummary> {
  const now = deps.now ?? Date.now

  // 先解析再读存档：文件本身不合法时不必白读一次存档
  const parsed = parseAnnotationTransfer(text, now())
  const existing = await deps.repository.listByBook(targetBookId)

  const plan = planAnnotationImport({
    existing,
    incoming: parsed.annotations,
    targetBookId,
    capacity: Math.max(0, MAX_ANNOTATIONS_PER_BOOK - existing.length)
  })

  // 空批次不写盘：导入一份全是重复条目的文件不该刷新存档的修改时间
  if (plan.toInsert.length > 0) await deps.repository.saveMany(plan.toInsert)

  return {
    added: plan.added,
    skipped: plan.skipped,
    dropped: parsed.dropped,
    trimmed: plan.trimmed,
    fromOtherBook: parsed.book.id !== targetBookId
  }
}
