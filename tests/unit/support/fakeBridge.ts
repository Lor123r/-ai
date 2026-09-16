import { InMemoryAnnotationRepository } from '@core/adapters/inMemoryAnnotationRepository'
import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import { InMemorySettingsRepository } from '@core/adapters/inMemorySettingsRepository'
import type { AnnotationRepository } from '@core/ports/annotationRepository'
import type { BookCover, CoverReader } from '@core/ports/bookCover'
import type { BookContentReader } from '@core/ports/bookContent'
import type { BookImporter } from '@core/ports/bookImporter'
import type { SettingsRepository } from '@core/ports/settingsRepository'
import type { AppBridge, RuntimeVersions } from '@shared/ipc'

export const DEFAULT_VERSIONS: RuntimeVersions = {
  node: '24.21.0',
  chrome: '140.0.0',
  electron: '38.2.0'
}

/** 默认导入器什么都不做（等同用户取消），测试需要时可覆盖。 */
export function createFakeImporter(
  pickAndImport: BookImporter['pickAndImport'] = async () => null
): BookImporter {
  return { pickAndImport }
}

/** 默认读取器一律返回 null（等同没有封面），测试需要时可覆盖。 */
export function createFakeCoverReader(books: Record<string, BookCover> = {}): CoverReader {
  return {
    read: async (bookId) => books[bookId] ?? null
  }
}

/** 默认正文读取器一律返回 null（等同没有这本书），测试需要时可覆盖。 */
export function createFakeContentReader(books: Record<string, Uint8Array> = {}): BookContentReader {
  return {
    read: async (bookId) => books[bookId] ?? null
  }
}

/** 默认设置仓库是全新的内存实现（等同从未保存过设置）。 */
export function createFakeSettingsRepository(): SettingsRepository {
  return new InMemorySettingsRepository()
}

/** 默认注解仓库是全新的内存实现（等同这本书还没有书签与划线）。 */
export function createFakeAnnotationRepository(): AnnotationRepository {
  return new InMemoryAnnotationRepository()
}

/** 造一个完整的 preload 桥，避免每个测试自己拼一份不完整的对象。 */
export function createFakeBridge(versions: RuntimeVersions = DEFAULT_VERSIONS): AppBridge {
  return {
    versions,
    books: new InMemoryBookRepository(),
    library: createFakeImporter(),
    cover: createFakeCoverReader(),
    content: createFakeContentReader(),
    settings: createFakeSettingsRepository(),
    annotations: createFakeAnnotationRepository()
  }
}

/** 把假桥挂到 window 上，返回清理函数。 */
export function installFakeBridge(versions: RuntimeVersions = DEFAULT_VERSIONS): () => void {
  window.api = createFakeBridge(versions)
  return () => {
    delete window.api
  }
}
