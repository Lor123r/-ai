import type { Annotation } from '../domain/annotation'

/**
 * 注解（书签与划线）的持久化端口。
 * UI 只依赖这个接口，实现可以是内存、SQLite 或主进程 IPC。
 * listByBook() 必须按 compareAnnotationsForList 的顺序返回。
 */
export interface AnnotationRepository {
  /** 显式预读；存档损坏时会抛出 AnnotationCorruptError。 */
  load(): Promise<void>
  listByBook(bookId: string): Promise<Annotation[]>
  /**
   * upsert：同一个 (bookId, id) 重复保存是覆盖而不是插入。
   * 渲染层的乐观更新可能重放同一条 IPC，重放不该造出重复条目。
   */
  save(annotation: Annotation): Promise<void>
  /** 删除不存在的注解时静默成功（幂等），调用方可以放心重试。 */
  remove(bookId: string, annotationId: string): Promise<void>
  /**
   * 删掉一本书的全部注解，返回删除条数。
   * 只给主进程的删书流程用，不进 AppBridge：删书必须先删书、后删注解，
   * 反序时删书失败就会造出「书还在、划线没了」的真数据丢失。
   */
  removeByBook(bookId: string): Promise<number>
}
