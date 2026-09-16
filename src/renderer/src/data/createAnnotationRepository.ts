import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import type { AnnotationRepository } from '@core/ports/annotationRepository'

/**
 * 有 IPC 桥就落到主进程，否则退化成会话内有效（浏览器预览与测试用）。
 *
 * 与 createBookRepository 的区别不是风格，是契约：桥只暴露 listByBook / save / remove，
 * 所以这里要显式补上另外两个方法的语义。
 *
 * - load() 空操作：主进程在启动时就预读过存档了，而且「读不到」这件事由它决定并降级
 *   （失败会回落内存实现 + 记警告）。渲染层再 load 一次只会把主进程的降级决定覆盖掉。
 * - removeByBook() 直接拒绝：删书必须先删书、后删注解，这个顺序只有主进程的删书流程
 *   知道。渲染层调它只会造成「书还在、划线没了」的真数据丢失，所以宁可在这里炸掉，
 *   也不要返回一个 0 假装删成功了。
 */
export function createAnnotationRepository(): AnnotationRepository {
  const bridge = typeof window === 'undefined' ? undefined : window.api
  const annotations = bridge?.annotations
  if (!annotations) return new InMemoryAnnotationRepository()

  return {
    load: async () => undefined,
    listByBook: (bookId) => annotations.listByBook(bookId),
    save: (annotation) => annotations.save(annotation),
    remove: (bookId, annotationId) => annotations.remove(bookId, annotationId),
    removeByBook: () => Promise.reject(new Error('删书清理注解只能由主进程执行，渲染层不得调用'))
  }
}
