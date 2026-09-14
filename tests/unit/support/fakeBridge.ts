import { InMemoryBookRepository } from '@core/adapters/inMemoryBookRepository'
import type { AppBridge, RuntimeVersions } from '@shared/ipc'

export const DEFAULT_VERSIONS: RuntimeVersions = {
  node: '24.21.0',
  chrome: '140.0.0',
  electron: '38.2.0'
}

/** 造一个完整的 preload 桥，避免每个测试自己拼一份不完整的对象。 */
export function createFakeBridge(versions: RuntimeVersions = DEFAULT_VERSIONS): AppBridge {
  return { versions, books: new InMemoryBookRepository() }
}

/** 把假桥挂到 window 上，返回清理函数。 */
export function installFakeBridge(versions: RuntimeVersions = DEFAULT_VERSIONS): () => void {
  window.api = createFakeBridge(versions)
  return () => {
    delete window.api
  }
}
