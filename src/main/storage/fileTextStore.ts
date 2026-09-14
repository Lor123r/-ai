import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TextStore } from '@core/ports/textStore'

const MISSING_FILE = 'ENOENT'

function isErrnoException(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code
}

/**
 * 基于文件的文本存储。
 * 写入先落临时文件再改名，避免写入中断留下半个 JSON 导致书库彻底读不出来。
 */
export class FileTextStore implements TextStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<string | null> {
    try {
      return await readFile(this.filePath, 'utf8')
    } catch (error) {
      if (isErrnoException(error, MISSING_FILE)) return null
      throw error
    }
  }

  async write(content: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })

    const temporaryPath = `${this.filePath}.tmp`
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, this.filePath)
  }
}
