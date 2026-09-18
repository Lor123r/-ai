import { compareAnnotationsForList, normalizeAnnotationBookId, type Annotation } from '../domain/annotation'
import { isRecord } from '../domain/guards'
import { parseAnnotationEntries, toAnnotationEntry } from './annotationEntry'

/**
 * 交换文件的身份标记。
 *
 * 导入时硬校验它，防的不是「随便挑了个文件」，而是用户跑进应用数据目录挑了自己的
 * annotations.json —— 那份全库存档的形状几乎是本格式的超集，光看 annotations 数组
 * 根本分不出来，条目会被整批当成「当前这本书的注解」写进去。
 */
export const ANNOTATION_TRANSFER_KIND = 'ebook-reader-annotations'

/**
 * 当前交换格式版本。
 * 与存档版本号各走各的：存档形状改一次（比如加字段）不代表交换语义变了，
 * 反之亦然，共用一个号会逼着两边一起跳版本。
 */
export const ANNOTATION_TRANSFER_VERSION = 1

/** 书名只是提示用户「这份文件导出自哪本书」，不参与任何判定，所以按展示文本收敛。 */
const MAX_TRANSFER_TITLE_LENGTH = 200
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

/** 文件本身不是本应用的交换格式时抛出，与「条目里有一条读不出来」区分开。 */
export class AnnotationTransferFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnnotationTransferFormatError'
  }
}

export interface AnnotationTransferBook {
  id: string
  title: string
}

export interface ParsedAnnotationTransfer {
  /** 信封里的书籍信息，只用于提示「导出自另一本书」，不参与写入。 */
  book: AnnotationTransferBook
  annotations: Annotation[]
  /** 字段非法被丢弃的条数。 */
  dropped: number
}

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return ''

  return raw.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TRANSFER_TITLE_LENGTH)
}

/**
 * 把一本书的注解导出成交换格式。
 *
 * 条目与存档共用同一份字段投影（toAnnotationEntry），所以「导出的东西」就是
 * 「存档里的东西」，两侧不会各自演化。与存档一样先排序再投影，同样的注解必定生成
 * 同样的字节，用户拿两份文件做 diff 时看到的是真实差异而不是顺序抖动。
 *
 * exportedAt 只写不读：它是给人看的，没有任何逻辑依赖它，读进类型里只会多一个
 * 没人用的字段。
 */
export function serializeAnnotationTransfer(
  book: AnnotationTransferBook,
  annotations: Iterable<Annotation>,
  now: number
): string {
  const envelope = {
    kind: ANNOTATION_TRANSFER_KIND,
    version: ANNOTATION_TRANSFER_VERSION,
    book: { id: book.id, title: normalizeTitle(book.title) },
    exportedAt: Math.round(now),
    annotations: [...annotations].sort(compareAnnotationsForList).map(toAnnotationEntry)
  }

  return `${JSON.stringify(envelope, null, 2)}\n`
}

/**
 * 解析交换文件。
 *
 * kind / version 不符一律整份拒绝，不做「尽力而为」：格式猜错的代价是把不属于这本书的
 * 条目静默写进用户的注解，比直接报错严重得多，而且用户完全看不出来。
 * 反过来说，只有单条记录坏掉时仍然宽容处理并计数，与存档的解析策略一致。
 *
 * bookId 只认信封里的那一个：条目自带的 bookId 被整个忽略（见 parseAnnotationEntries），
 * 这样「所有条目都属于同一本书」是结构性成立的，不需要额外校验。
 */
export function parseAnnotationTransfer(text: string, now: number): ParsedAnnotationTransfer {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new AnnotationTransferFormatError('文件不是合法的 JSON')
  }

  if (!isRecord(raw)) throw new AnnotationTransferFormatError('文件根节点不是对象')
  if (raw.kind !== ANNOTATION_TRANSFER_KIND) throw new AnnotationTransferFormatError('这不是本应用导出的注解文件')
  if (raw.version !== ANNOTATION_TRANSFER_VERSION) {
    throw new AnnotationTransferFormatError(
      `文件格式版本为 ${String(raw.version)}，当前版本只能读 ${ANNOTATION_TRANSFER_VERSION}`
    )
  }

  const book = isRecord(raw.book) ? raw.book : null
  const bookId = normalizeAnnotationBookId(book?.id)
  if (bookId === null) throw new AnnotationTransferFormatError('文件里没有可用的书籍标识')

  // annotations 缺失或不是数组时整份拒绝而不是当成空列表：「导入成功，新增 0 条」
  // 会让用户以为文件没问题，反而去怀疑自己的操作
  if (!Array.isArray(raw.annotations)) throw new AnnotationTransferFormatError('文件里没有注解列表')

  const parsed = parseAnnotationEntries(raw.annotations, now, bookId)

  return {
    book: { id: bookId, title: normalizeTitle(book?.title) },
    annotations: parsed.entries,
    dropped: parsed.dropped
  }
}
