import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { JsonAnnotationRepository } from '@core/adapters/jsonAnnotationRepository'
import { isCorruptAnnotationError } from '@core/adapters/annotationSnapshot'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import { FileTextStore } from './fileTextStore'

export const ANNOTATIONS_FILE_NAME = 'annotations.json'

export function resolveAnnotationsFilePath(userDataDir: string): string {
  return join(userDataDir, ANNOTATIONS_FILE_NAME)
}

export interface OpenAnnotationsResult {
  repository: AnnotationRepository
  /** 损坏存档的备份路径；非空表示这次是「救回来」的启动。 */
  recoveredFiles: string[]
}

/**
 * 打开注解存档。存档损坏时不删除用户数据，而是改名备份后以空存档启动，
 * 保证应用永远能起来，也保证用户仍有机会找回原始文件。
 */
export async function openAnnotations(
  filePath: string,
  now: () => number = Date.now
): Promise<OpenAnnotationsResult> {
  const repository = new JsonAnnotationRepository(new FileTextStore(filePath), now)

  try {
    await repository.load()
    return { repository, recoveredFiles: [] }
  } catch (error) {
    // 只认「注解存档损坏」。其它异常（IO 失败、书库的损坏错误）原样抛出：
    // 绝不能把书库的损坏当成注解损坏去备份。
    if (!isCorruptAnnotationError(error)) throw error

    const backupPath = `${filePath}.corrupt-${now()}`
    let backedUp = false
    try {
      await rename(filePath, backupPath)
      backedUp = true
    } catch {
      // 备份失败（文件被占用或已被删除）不能阻止启动
    }

    const recovered = new JsonAnnotationRepository(new FileTextStore(filePath), now)
    // 差异一：只有备份成功才重新读。备份失败时磁盘上仍是那个坏文件，再读一次会二次抛错；
    // 书库那边的恢复流程正是在这里再读了一次，所以它注释里那句「备份失败不应阻止应用启动」
    // 是假的 —— 一旦 rename 被占用抛错，异常会一路穿到 whenReady 回调（那里没有 catch）
    // 并让窗口起不来。注解存档不能重复这个错。
    if (backedUp) await recovered.load()

    // 差异二：recoveredFiles 与书库那边的恢复流程一样只表示「这次是救回来的启动」，
    // 无论 rename 是否成功都返回该路径。
    return { repository: recovered, recoveredFiles: [backupPath] }
  }
}
