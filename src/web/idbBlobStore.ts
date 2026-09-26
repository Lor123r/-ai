import type { BookCover } from '@core/ports/bookCover'
import type { BookContentReader } from '@core/ports/bookContent'
import type { CoverReader } from '@core/ports/bookCover'
import { STORE, get, put, remove } from './idb'

/**
 * 字节仓里的一行。
 *
 * 正文与封面共用一个仓，靠 key 前缀区分：两者都是「按 bookId 取一段字节」，
 * 分成两个仓只会多一份几乎相同的读写代码。前缀用 `content:` / `cover:`，
 * 冒号不在 bookId（sha256 十六进制）的字符集里，不会撞车。
 */
interface BlobRow {
  key: string
  bytes: Uint8Array
  mediaType: string
}

function contentKey(bookId: string): string {
  return `content:${bookId}`
}

function coverKey(bookId: string): string {
  return `cover:${bookId}`
}

/** 浏览器宿主的正文读取器。读不到（没导入过、被删了）返回 null 而不是抛错。 */
export class IdbBookContentReader implements BookContentReader {
  async read(bookId: string): Promise<Uint8Array | null> {
    const row = await get<BlobRow>(STORE.blobs, contentKey(bookId))
    return row?.bytes ?? null
  }
}

/** 浏览器宿主的封面读取器。 */
export class IdbCoverReader implements CoverReader {
  async read(bookId: string): Promise<BookCover | null> {
    const row = await get<BlobRow>(STORE.blobs, coverKey(bookId))
    if (!row) return null

    return { bytes: row.bytes, mediaType: row.mediaType }
  }
}

/** 写入正文与封面。导入流程用，不属于 AppBridge 暴露给渲染层的接口。 */
export const blobWriter = {
  async writeContent(bookId: string, bytes: Uint8Array): Promise<void> {
    await put(STORE.blobs, { key: contentKey(bookId), bytes, mediaType: 'application/epub+zip' } satisfies BlobRow)
  },

  async writeCover(bookId: string, bytes: Uint8Array, mediaType: string): Promise<void> {
    await put(STORE.blobs, { key: coverKey(bookId), bytes, mediaType } satisfies BlobRow)
  },

  async removeContent(bookId: string): Promise<void> {
    await remove(STORE.blobs, contentKey(bookId))
  },

  async removeCover(bookId: string): Promise<void> {
    await remove(STORE.blobs, coverKey(bookId))
  }
}
