import type { BookCover } from '@core/ports/bookCover'

/** 分块转换，避免一次展开几万个参数把调用栈撑爆。 */
const BASE64_CHUNK_SIZE = 8192

/**
 * 把封面字节拼成 data URL。
 * 不用 URL.createObjectURL 是因为它需要在组件卸载时手工释放，
 * 漏掉一次就会一直占着内存；封面体积小，直接内联更省心。
 */
export function toCoverDataUrl(cover: BookCover): string {
  let binary = ''
  for (let offset = 0; offset < cover.bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = cover.bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)
    binary += String.fromCharCode(...chunk)
  }

  return `data:${cover.mediaType};base64,${btoa(binary)}`
}
