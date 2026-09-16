import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import type { BookRepository } from '@core/ports/bookRepository'
import { openAnnotations, resolveAnnotationsFilePath } from './annotations'
import { openLibrary, resolveLibraryFilePath } from './library'

export interface StorageBoot {
  library: BookRepository
  annotations: AnnotationRepository
  /** 需要在控制台留痕的启动期异常；为空表示这次是干净启动。 */
  warnings: string[]
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 打开本次启动要用的全部存档，**任何情况下都返回可用对象，从不抛错**。
 *
 * 启动链上没有人接得住异常：`whenReady().then(...)` 之外没有 catch，一次读失败
 * 就意味着窗口永远不出现、进程却还在跑 —— 用户既看不到错误，也不知道该做什么。
 *
 * 「存档损坏」由各自的 open* 处理（改名备份后以空存档启动，仍然读写磁盘）。
 * 这里兜的是它们按设计原样抛出的那一类：路径是目录、权限不足、文件被占用。
 * 此时回落目标必须是**不落盘**的内存实现，不能是同一套 JSON 仓储：JSON 仓储在
 * 读失败之后内部集合是空的，下一次写入会把「空集合 + 新内容」覆盖回磁盘，等于把
 * 用户原有的数据整份抹掉。降级的代价只是「本次会话的改动不保存」，磁盘上那份
 * 文件一个字节都不会动，用户仍有自己抢救的机会。
 */
export async function openStorageForStartup(
  userDataDir: string,
  now: () => number = Date.now
): Promise<StorageBoot> {
  const warnings: string[] = []

  let library: BookRepository = new InMemoryBookRepository()
  try {
    const opened = await openLibrary(resolveLibraryFilePath(userDataDir), now)
    library = opened.repository
    if (opened.recoveredFiles.length > 0) {
      warnings.push(`书库存档无法读取，本次以空书库启动；备份目标 ${opened.recoveredFiles.join(', ')}`)
    }
  } catch (error) {
    warnings.push(`书库无法打开，本次会话的书架改动不会保存：${toMessage(error)}`)
  }

  let annotations: AnnotationRepository = new InMemoryAnnotationRepository()
  try {
    const opened = await openAnnotations(resolveAnnotationsFilePath(userDataDir), now)
    annotations = opened.repository
    if (opened.recoveredFiles.length > 0) {
      warnings.push(`注解存档无法读取，本次以空存档启动；备份目标 ${opened.recoveredFiles.join(', ')}`)
    }
  } catch (error) {
    warnings.push(`注解存档无法打开，本次会话的书签与划线不会保存：${toMessage(error)}`)
  }

  return { library, annotations, warnings }
}
