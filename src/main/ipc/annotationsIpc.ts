import type { IpcMain } from 'electron'
import { isValidAnnotationId, normalizeAnnotationBookId, reviveAnnotation } from '@core/domain/annotation'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import { ANNOTATION_CHANNELS } from '@shared/ipc'

function requireBookId(value: unknown): string {
  const bookId = normalizeAnnotationBookId(value)
  if (bookId === null) throw new Error('注解所属书籍 id 不合法')
  return bookId
}

/**
 * 删除路径上的 id 必须 trim 后再用。
 * isValidAnnotationId 内部就是 trim 之后判的，直接拿原值当键会让 ' a1 ' 与 'a1'
 * 变成两个不同的条目 —— 渲染层删了却删不掉，或者干脆删出个「不存在」的静默成功。
 */
function requireAnnotationId(value: unknown): string {
  if (!isValidAnnotationId(value)) throw new Error('注解 id 不合法')
  return value.trim()
}

/**
 * 注册注解 IPC。
 * 渲染层的写入路径是乐观更新，这条 id 到主进程时已经在信任边界之外，
 * 所以 save 一律先过 reviveAnnotation（逐字段收敛 + 非法整条拒绝），
 * 而不是把渲染层递来的对象直接落盘。
 */
export function registerAnnotationsIpc(ipcMain: IpcMain, repository: AnnotationRepository): void {
  ipcMain.handle(ANNOTATION_CHANNELS.list, (_event, bookId: unknown) =>
    repository.listByBook(requireBookId(bookId))
  )

  ipcMain.handle(ANNOTATION_CHANNELS.save, (_event, raw: unknown) => {
    const annotation = reviveAnnotation(raw)
    if (!annotation) throw new Error('注解数据不合法')
    return repository.save(annotation)
  })

  ipcMain.handle(ANNOTATION_CHANNELS.remove, (_event, bookId: unknown, annotationId: unknown) =>
    repository.remove(requireBookId(bookId), requireAnnotationId(annotationId))
  )
}
