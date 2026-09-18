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

  async saveMany(annotations: readonly Annotation[]): Promise<void> {
    // 空批次不产生任何 I/O：没有要落盘的东西，就不必先把存档读一遍
    if (annotations.length === 0) return

    await this.runExclusive(async () => {
      await this.ensureLoaded()

      // 先整体校验再改动：容量不够时整批拒绝，不会留下「写进去一半」的存档。
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

      // 空批次在上面已经返回过了，走到这里必定有东西要写

      // 批内同 id 后写的覆盖先写的，与依次调用 save 的语义一致
      for (const annotation of annotations) {
        this.annotations.set(storageKey(annotation.bookId, annotation.id), { ...annotation })
      }

      // 整批只写一次盘。逐条 save 会因为每次 flush 都把整份存档重写一遍，
      // 这正是 saveMany 存在的理由
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
