import type { Annotation } from '@core/domain/annotation'
import type { AnnotationRepository } from '@core/ports/annotationRepository'

/**
 * 降级期间对外的唯一文案。IPC 会把它包装成
 * `Error invoking remote method 'annotations:save': Error: ...`，所以渲染层**不得**
 * 原样回显（它有自己的固定文案），这个常量主要是给日志与测试用的锚点。
 */
export const ANNOTATIONS_UNAVAILABLE_MESSAGE = '注解存档本次会话不可用，重启应用后可能恢复'

/**
 * 启动期注解存档打不开时的兜底替身：**任何数据操作都失败**。
 *
 * 这里刻意不用 InMemoryAnnotationRepository。它的 save 会 resolve 并在内存里留下副本，
 * 于是渲染层的乐观更新一路走通、界面如实显示「已保存」，而磁盘上什么都没有 —— 用户
 * 很可能就此关掉应用，整个会话的标注灰飞烟灭，且过程中没有任何提示。这是唯一一条
 * 「界面说存了、磁盘没有」的真实路径，渲染层权限内没有任何办法察觉到它，只能由主进程
 * 在源头把写入变成明确失败。
 *
 * 读也一起失败是有意为之：listByBook 返回空数组会让界面宣称「这本书还没有注解」，
 * 那同样是假话（磁盘上可能正躺着一份读不出来的存档），还会把用户引向「重新标一遍」，
 * 可重新标一样会失败。五个数据方法装死之后，整个功能一致地表现为「本次会话用不了」，
 * 渲染层只要走它本来就有的失败与回滚路径即可。
 *
 * load() 是唯一保持 resolve 的方法：它的契约在桥接实现里本来就是空操作，而且在启动链
 * 上没有任何调用方 —— 让唯一一个非数据操作的方法保持 no-op，可以避免给启动链引入一个
 * 可能被忽略的 rejection。
 *
 * 类的归属也刻意放在 main 而不是 core/adapters：它编码的是「启动降级之后本次会话的
 * 策略」，不是一种通用后端。放进 core 会多出一段只有一个调用方、且通不过
 * annotationRepositoryContract 的代码（那份契约要求 save 之后能读回来）。
 */
export class UnavailableAnnotationRepository implements AnnotationRepository {
  async load(): Promise<void> {
    // 主进程已经替渲染层决定了「本次会话没有可加载的存档」，这里无事可做
  }

  async listByBook(_bookId: string): Promise<Annotation[]> {
    throw new Error(ANNOTATIONS_UNAVAILABLE_MESSAGE)
  }

  async save(_annotation: Annotation): Promise<void> {
    throw new Error(ANNOTATIONS_UNAVAILABLE_MESSAGE)
  }

  async saveMany(_annotations: readonly Annotation[]): Promise<void> {
    throw new Error(ANNOTATIONS_UNAVAILABLE_MESSAGE)
  }

  async remove(_bookId: string, _annotationId: string): Promise<void> {
    throw new Error(ANNOTATIONS_UNAVAILABLE_MESSAGE)
  }

  async removeByBook(_bookId: string): Promise<number> {
    throw new Error(ANNOTATIONS_UNAVAILABLE_MESSAGE)
  }
}
