import {
  MAX_ANNOTATIONS_PER_BOOK,
  compareAnnotationsForList,
  reviveAnnotation,
  type Annotation
} from '../domain/annotation'
import { isRecord } from '../domain/guards'

export const ANNOTATION_FORMAT_VERSION = 1

export interface AnnotationSnapshot {
  version: number
  annotations: Annotation[]
}

/** 存档无法解析时抛出，调用方据此备份原文件并以空存档启动。 */
export class AnnotationCorruptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnnotationCorruptError'
  }
}

/**
 * 逐字段显式构造要落盘的对象。
 * 不能直接把入参 spread 出去：那样会把磁盘上读出来的未知字段（甚至是被塞进来的
 * 恶意字段）原样再写回去，存档里的垃圾数据就永远清不掉了。
 */
function toSnapshotEntry(annotation: Annotation): Annotation {
  // 两个分支都逐字段写全，字段顺序与 createBookmark / createHighlight 保持一致
  if (annotation.kind === 'highlight') {
    return {
      id: annotation.id,
      bookId: annotation.bookId,
      kind: 'highlight',
      cfi: annotation.cfi,
      chapterHref: annotation.chapterHref,
      percent: annotation.percent,
      note: annotation.note,
      excerpt: annotation.excerpt,
      color: annotation.color,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt
    }
  }

  return {
    id: annotation.id,
    bookId: annotation.bookId,
    kind: 'bookmark',
    cfi: annotation.cfi,
    chapterHref: annotation.chapterHref,
    percent: annotation.percent,
    note: annotation.note,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt
  }
}

export function serializeAnnotations(annotations: Iterable<Annotation>): string {
  const ordered = [...annotations].sort(compareAnnotationsForList)

  const snapshot: AnnotationSnapshot = {
    version: ANNOTATION_FORMAT_VERSION,
    annotations: ordered.map(toSnapshotEntry)
  }

  return `${JSON.stringify(snapshot, null, 2)}\n`
}

export interface ParsedAnnotations {
  annotations: Annotation[]
  /**
   * 被丢弃的条目数量，用于诊断而不是静默吞掉。
   *
   * 三种原因**合并计数**，不区分来源：
   * ① 字段非法导致 reviveAnnotation 返回 null；
   * ② 同一个 (bookId, id) 出现多次，只保留排序后靠前的那条；
   * ③ 超出 MAX_ANNOTATIONS_PER_BOOK 被裁掉。
   *
   * ③ 不是数据损坏，而是对超限存档的正常裁剪，所以这个数偏大并不等于存档有问题。
   * 目前没有生产调用方读它（JsonAnnotationRepository.ensureLoaded 直接丢弃），
   * 界面真要区分「数据坏了」和「正常裁剪」，得先把这个数拆成明细。
   */
  dropped: number
}

/**
 * 宽容解析：单条记录损坏只丢弃该条并计数，不影响整份存档读取。
 * 只有整个文件不是合法 JSON / 根节点不是对象时才判定为损坏。
 * 这里不判断书籍是否存在：注解独立成档，没有 books 数组也就没有「孤儿 locator」那一档。
 */
export function parseAnnotations(text: string, now: number = Date.now()): ParsedAnnotations {
  // 空文件是正常的首次启动状态，不是损坏
  if (text.trim() === '') return { annotations: [], dropped: 0 }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new AnnotationCorruptError('注解文件不是合法的 JSON')
  }

  if (!isRecord(raw)) throw new AnnotationCorruptError('注解文件根节点不是对象')

  const byBook = new Map<string, Annotation[]>()
  let dropped = 0

  const rawAnnotations = Array.isArray(raw.annotations) ? raw.annotations : []
  for (const entry of rawAnnotations) {
    const annotation = reviveAnnotation(entry, now)
    if (!annotation) {
      dropped += 1
      continue
    }

    const bucket = byBook.get(annotation.bookId)
    if (bucket) bucket.push(annotation)
    else byBook.set(annotation.bookId, [annotation])
  }

  const annotations: Annotation[] = []
  for (const bucket of byBook.values()) {
    // seen 只装保留下来的 id，所以它的 size 就是「已保留条数」
    const seen = new Set<string>()
    for (const annotation of [...bucket].sort(compareAnnotationsForList)) {
      // 同一个 (bookId, id) 只保留排序后最靠前的那条，重复的重放请求不会变成多条
      if (seen.has(annotation.id)) {
        dropped += 1
        continue
      }
      if (seen.size >= MAX_ANNOTATIONS_PER_BOOK) {
        dropped += 1
        continue
      }
      seen.add(annotation.id)
      annotations.push(annotation)
    }
  }

  // 全局再排一次，保证输出与输入数组的顺序完全无关，存档文本才是字节稳定的
  annotations.sort(compareAnnotationsForList)
  return { annotations, dropped }
}

export function isCorruptAnnotationError(error: unknown): error is AnnotationCorruptError {
  return error instanceof AnnotationCorruptError
}
