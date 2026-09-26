import {
  MAX_ANNOTATIONS_PER_BOOK,
  compareAnnotationsForList,
  reviveAnnotation,
  type Annotation
} from '@core/domain/annotation'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import { STORE, getAll, put, putMany, remove } from './idb'

/**
 * 与 JsonAnnotationRepository 同款的内部键：NUL 不在注解 id 的字符集白名单里，
 * 所以它不可能出现在任何一段里，拼接也就不会出现歧义。
 */
function storageKey(bookId: string, id: string): string {
  return `${bookId}\u0000${id}`
}

interface AnnotationRow {
  key: string
  annotation: Annotation
}

/**
 * 浏览器宿主的注解仓库。
 *
 * 语义必须与 JsonAnnotationRepository / InMemoryAnnotationRepository 完全一致
 * （覆盖式 save、幂等 remove、每本书的条数上限），三者跑同一份契约测试。
 */
export class IdbAnnotationRepository implements AnnotationRepository {
  async load(): Promise<void> {
    // IndexedDB 没有「启动期预读」这一步：读是异步的，且没有主进程那样的
    // 「先把存档读进内存再服务请求」的需要。留空实现以满足端口契约。
  }

  async listByBook(bookId: string): Promise<Annotation[]> {
    return (await this.ofBook(bookId)).map((annotation) => ({ ...annotation }))
  }

  async save(annotation: Annotation): Promise<void> {
    const existing = await this.ofBook(annotation.bookId)
    const key = storageKey(annotation.bookId, annotation.id)
    // 覆盖已有条目不算增长，否则改一次颜色就会被上限挡住
    const isNew = !existing.some((item) => storageKey(item.bookId, item.id) === key)
    if (isNew && existing.length >= MAX_ANNOTATIONS_PER_BOOK) throw new Error('注解数量已达上限')

    await put(STORE.annotations, { key, annotation } satisfies AnnotationRow)
  }

  async saveMany(annotations: readonly Annotation[]): Promise<void> {
    // 先整体校验再改动：容量不够时整批拒绝，不会留下「写进去一半」的状态。
    // 同一批里重复出现的 id 只算一次增长，否则一批里塞满同一个 id 会误判超限。
    const pending = new Map<string, Annotation>()
    for (const annotation of annotations) {
      pending.set(storageKey(annotation.bookId, annotation.id), annotation)
    }

    // 按书分组统计「这批里有多少条是新的」，再逐本对照上限
    const freshByBook = new Map<string, number>()
    for (const [key, annotation] of pending) {
      const existing = await this.ofBook(annotation.bookId)
      const isNew = !existing.some((item) => storageKey(item.bookId, item.id) === key)
      if (!isNew) continue

      freshByBook.set(annotation.bookId, (freshByBook.get(annotation.bookId) ?? 0) + 1)
    }

    for (const [bookId, fresh] of freshByBook) {
      const existing = await this.ofBook(bookId)
      if (existing.length + fresh > MAX_ANNOTATIONS_PER_BOOK) throw new Error('注解数量已达上限')
    }

    // 批内同 id 后写的覆盖先写的，与依次调用 save 的语义一致
    await putMany(
      STORE.annotations,
      [...pending].map(([key, annotation]) => ({ key, annotation })) satisfies AnnotationRow[]
    )
  }

  async remove(bookId: string, annotationId: string): Promise<void> {
    await remove(STORE.annotations, storageKey(bookId, annotationId))
  }

  async removeByBook(bookId: string): Promise<number> {
    const existing = await this.ofBook(bookId)
    for (const annotation of existing) {
      await remove(STORE.annotations, storageKey(annotation.bookId, annotation.id))
    }

    return existing.length
  }

  private async ofBook(bookId: string): Promise<Annotation[]> {
    const rows = await getAll<AnnotationRow>(STORE.annotations)
    const result: Annotation[] = []

    for (const row of rows) {
      const annotation = reviveAnnotation(row?.annotation)
      if (annotation && annotation.bookId === bookId) result.push(annotation)
    }

    return result.sort(compareAnnotationsForList)
  }
}
