import { MAX_ANNOTATIONS_PER_BOOK, compareAnnotationsForList, type Annotation } from '../domain/annotation'
import type { AnnotationRepository } from '../ports/annotationRepository'

/**
 * 与 JsonAnnotationRepository 同款的内部键：NUL 不在注解 id 的字符集白名单里，
 * 所以它不可能出现在任何一段里，拼接也就不会出现歧义。
 */
function storageKey(bookId: string, id: string): string {
  return `${bookId}\u0000${id}`
}

/**
 * 内存实现：单元测试与「没有 IPC 桥」的浏览器预览用它。
 * 语义必须与 JsonAnnotationRepository 完全一致（覆盖式 save、幂等 remove、
 * 每本书的条数上限），两者跑同一份契约测试，谁漂移了都会被立刻发现。
 */
export class InMemoryAnnotationRepository implements AnnotationRepository {
  private readonly annotations = new Map<string, Annotation>()

  async load(): Promise<void> {
    // 没有磁盘可读，启动期预读是空操作
  }

  async listByBook(bookId: string): Promise<Annotation[]> {
    return this.ofBook(bookId).map((annotation) => ({ ...annotation }))
  }

  async save(annotation: Annotation): Promise<void> {
    const key = storageKey(annotation.bookId, annotation.id)
    // 覆盖已有条目不算增长，否则改一次颜色就会被上限挡住
    if (!this.annotations.has(key) && this.ofBook(annotation.bookId).length >= MAX_ANNOTATIONS_PER_BOOK) {
      throw new Error('注解数量已达上限')
    }

    this.annotations.set(key, { ...annotation })
  }

  async saveMany(annotations: readonly Annotation[]): Promise<void> {
    // 先整体校验再改动：容量不够时整批拒绝，不会留下「写进去一半」的状态。
    // 同一批里重复出现的 id 只算一次增长，否则一批里塞满同一个 id 会误判超限。
    const pending = new Set<string>()
    const growth = new Map<string, number>()

    for (const annotation of annotations) {
      const key = storageKey(annotation.bookId, annotation.id)
      if (this.annotations.has(key) || pending.has(key)) continue

      pending.add(key)
      growth.set(annotation.bookId, (growth.get(annotation.bookId) ?? 0) + 1)
    }

    for (const [bookId, added] of growth) {
      if (this.ofBook(bookId).length + added > MAX_ANNOTATIONS_PER_BOOK) {
        throw new Error('注解数量已达上限')
      }
    }

    // 批内同 id 后写的覆盖先写的，与依次调用 save 的语义一致
    for (const annotation of annotations) {
      this.annotations.set(storageKey(annotation.bookId, annotation.id), { ...annotation })
    }
  }

  async remove(bookId: string, annotationId: string): Promise<void> {
    this.annotations.delete(storageKey(bookId, annotationId))
  }

  async removeByBook(bookId: string): Promise<number> {
    let removed = 0
    for (const [key, annotation] of this.annotations) {
      if (annotation.bookId !== bookId) continue
      this.annotations.delete(key)
      removed += 1
    }

    return removed
  }

  private ofBook(bookId: string): Annotation[] {
    const result: Annotation[] = []
    for (const annotation of this.annotations.values()) {
      if (annotation.bookId === bookId) result.push(annotation)
    }

    return result.sort(compareAnnotationsForList)
  }
}
