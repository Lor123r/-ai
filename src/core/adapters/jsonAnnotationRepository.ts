import { MAX_ANNOTATIONS_PER_BOOK, compareAnnotationsForList, type Annotation } from '../domain/annotation'
import type { AnnotationRepository } from '../ports/annotationRepository'
import type { TextStore } from '../ports/textStore'
import { parseAnnotations, serializeAnnotations } from './annotationSnapshot'

/**
 * 内部键用 NUL 分隔 bookId 与 id。
 * NUL 不在注解 id 的字符集白名单里，所以这个分隔符不可能出现在任何一段里，
 * 拼接也就不会出现「两个不同的 (bookId, id) 拼出同一个键」的歧义。
 */
function storageKey(bookId: string, id: string): string {
  return `${bookId}\u0000${id}`
}

/**
 * 把全部注解写成一份 JSON 文本。
 * 所有读写都串行化（单用户场景下足够），避免并发保存互相覆盖。
 */
export class JsonAnnotationRepository implements AnnotationRepository {
  private annotations = new Map<string, Annotation>()
  private loaded = false
  private lock: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: TextStore,
    private readonly now: () => number = Date.now
  ) {}

  async load(): Promise<void> {
    await this.runExclusive(async () => this.ensureLoaded())
  }

  async listByBook(bookId: string): Promise<Annotation[]> {
    return this.runExclusive(async () => {
      await this.ensureLoaded()
      return this.ofBook(bookId).map((annotation) => ({ ...annotation }))
    })
  }

  async save(annotation: Annotation): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded()

      const key = storageKey(annotation.bookId, annotation.id)
      // 覆盖已有条目不算增长，否则改一次颜色就会被上限挡住
      if (!this.annotations.has(key) && this.ofBook(annotation.bookId).length >= MAX_ANNOTATIONS_PER_BOOK) {
        throw new Error('注解数量已达上限')
      }

      this.annotations.set(key, { ...annotation })
      await this.flush()
    })
  }

  async remove(bookId: string, annotationId: string): Promise<void> {
    await this.runExclusive(async () => {
      await this.ensureLoaded()

      // 和 removeByBook 一致：没有任何改动就不写盘。删除是幂等的，重试或删除一个
      // 已经被删掉的 id 都会走到这里，无谓的写盘会让存档文件的修改时间不断被刷新。
      if (!this.annotations.delete(storageKey(bookId, annotationId))) return

      await this.flush()
    })
  }

  async removeByBook(bookId: string): Promise<number> {
    return this.runExclusive(async () => {
      await this.ensureLoaded()

      let removed = 0
      for (const [key, annotation] of this.annotations) {
        if (annotation.bookId !== bookId) continue
        this.annotations.delete(key)
        removed += 1
      }

      // 没有任何改动就不写盘：删一本没有注解的书不该顺手创建一个空存档文件
      if (removed > 0) await this.flush()
      return removed
    })
  }

  private ofBook(bookId: string): Annotation[] {
    const result: Annotation[] = []
    for (const annotation of this.annotations.values()) {
      if (annotation.bookId === bookId) result.push(annotation)
    }

    return result.sort(compareAnnotationsForList)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    const text = await this.store.read()
    if (text !== null && text.trim() !== '') {
      const parsed = parseAnnotations(text, this.now())
      this.annotations = new Map(
        parsed.annotations.map((annotation) => [storageKey(annotation.bookId, annotation.id), annotation])
      )
    }

    this.loaded = true
  }

  private async flush(): Promise<void> {
    await this.store.write(serializeAnnotations(this.annotations.values()))
  }

  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.lock.then(task, task)
    this.lock = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
