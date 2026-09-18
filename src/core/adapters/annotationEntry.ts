import { reviveAnnotation, type Annotation } from '../domain/annotation'
import { isRecord } from '../domain/guards'

/**
 * 逐字段显式构造要写出去的对象。
 *
 * 不能直接把入参 spread 出去：那样会把磁盘上读出来的未知字段（甚至是被塞进来的
 * 恶意字段）原样再写回去，存档里的垃圾数据就永远清不掉了。
 *
 * 存档与交换文件共用这一份投影。两边各写一份的话，「导出的东西」会慢慢和
 * 「存档里的东西」漂移，而漂移只会在用户拿导出文件去另一台机器上导入时才暴露。
 */
export function toAnnotationEntry(annotation: Annotation): Annotation {
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

export interface ParsedAnnotationEntries {
  entries: Annotation[]
  /** id / bookId / kind / cfi 任一不可用，reviveAnnotation 返回 null 的条数。 */
  dropped: number
}

/**
 * 条目层解析：逐条收敛，不做去重、不做上限裁剪、不认任何格式信封
 * —— 那些都是各格式自己的事，两个调用方要的语义也不一样。
 *
 * overrideBookId 供交换格式用：bookId 一律以文件信封为准，条目自带的那个被忽略。
 * 忽略而不是「两处都认」是刻意的 —— 文件里的条目可能来自好几本书，
 * 一旦有两条同 id 的条目各自带着自己的 bookId 就能同时存活，重定向之后才会撞车。
 */
export function parseAnnotationEntries(
  rawEntries: readonly unknown[],
  now: number,
  overrideBookId?: string
): ParsedAnnotationEntries {
  const entries: Annotation[] = []
  let dropped = 0

  for (const raw of rawEntries) {
    // 只覆盖记录类型；其它类型原样交给 reviveAnnotation 去拒绝
    const source = overrideBookId === undefined || !isRecord(raw) ? raw : { ...raw, bookId: overrideBookId }
    const annotation = reviveAnnotation(source, now)
    if (annotation === null) {
      dropped += 1
      continue
    }

    entries.push(annotation)
  }

  return { entries, dropped }
}
