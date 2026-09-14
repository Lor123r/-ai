const MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

/** 扩展名认不出来时的兜底类型，让浏览器至少敢去解码。 */
export const DEFAULT_COVER_MEDIA_TYPE = 'image/jpeg'

/** 由封面文件路径推断 MIME 类型，用于在渲染进程里拼出可显示的图片地址。 */
export function mediaTypeForCover(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex < 0) return DEFAULT_COVER_MEDIA_TYPE

  const extension = filePath.slice(dotIndex + 1).toLowerCase()
  return MEDIA_TYPES[extension] ?? DEFAULT_COVER_MEDIA_TYPE
}
