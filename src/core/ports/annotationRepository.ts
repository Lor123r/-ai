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
  /**
   * 一次写入一批注解，整批全有或全无。
   *
   * 供导入流程用：逐条调 save 会让每次调用都全量重写一次存档（导入 100 条就是 100 次写盘），
   * 中途失败还会留下一份「导了一半」的存档，用户重试时又得自己认哪些进去过。
   *
   * 容量不够时整批 reject，不做截断写入：截掉多少该由调用方决定（见 planAnnotationImport），
   * 实现在里面偷偷截，会让调用方上报的条数和真实落盘的条数对不上。
   *
   * 只给主进程用，不进 AppBridge —— 渲染层没有批量写场景，与 removeByBook 同理。
   */
  saveMany(annotations: readonly Annotation[]): Promise<void>
  /** 删除不存在的注解时静默成功（幂等），调用方可以放心重试。 */
  remove(bookId: string, annotationId: string): Promise<void>
  /**
   * 删掉一本书的全部注解，返回删除条数。
   * 只给主进程的删书流程用，不进 AppBridge：删书必须先删书、后删注解，
   * 反序时删书失败就会造出「书还在、划线没了」的真数据丢失。
   */
  removeByBook(bookId: string): Promise<number>
}
