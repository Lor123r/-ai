import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { JsonBookRepository } from '@core/adapters/jsonBookRepository'
import { isCorruptLibraryError } from '@core/adapters/librarySnapshot'
import type { BookRepository } from '@core/ports/bookRepository'
import { FileTextStore } from './fileTextStore'

export const LIBRARY_FILE_NAME = 'library.json'

export function resolveLibraryFilePath(userDataDir: string): string {
  return join(userDataDir, LIBRARY_FILE_NAME)
}

export interface OpenLibraryResult {
  repository: BookRepository
  /** 损坏存档的备份路径；非空表示这次是「救回来」的启动。 */
  recoveredFiles: string[]
}

/**
 * 打开书库。存档损坏时不删除用户数据，而是改名备份后以空书库启动，
 * 保证应用永远能起来，也保证用户仍有机会找回原始文件。
 */
export async function openLibrary(filePath: string, now: () => number = Date.now): Promise<OpenLibraryResult> {
  const repository = new JsonBookRepository(new FileTextStore(filePath), now)

  try {
    await repository.load()
    return { repository, recoveredFiles: [] }
  } catch (error) {
    if (!isCorruptLibraryError(error)) throw error

    const backupPath = `${filePath}.corrupt-${now()}`
    try {
      await rename(filePath, backupPath)
    } catch {
      // 备份失败（例如文件已被删除）不应阻止应用启动
    }

    const recovered = new JsonBookRepository(new FileTextStore(filePath), now)
    await recovered.load()
    return { repository: recovered, recoveredFiles: [backupPath] }
  }
}
