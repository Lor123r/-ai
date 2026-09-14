import { attributeOf, childNode, nodesNamed, parseXml, textOf } from './xml'

export const CONTAINER_PATH = 'META-INF/container.xml'

/** 封面候选：优先扩展名，其次 media-type。 */
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg'
}

/** 从 container.xml 里取出 OPF 在 zip 内的路径。 */
export function parseContainerXml(xml: string): string | null {
  const root = childNode(parseXml(xml), 'container')
  const rootfile = nodesNamed(childNode(root, 'rootfiles'), 'rootfile')[0]
  const fullPath = attributeOf(rootfile, 'full-path')

  return fullPath === null ? null : normalizeZipPath(fullPath)
}

export interface EpubPackage {
  title: string | null
  author: string | null
  identifier: string | null
  /** 封面文件相对 OPF 所在目录的 href；没有封面时为 null。 */
  coverHref: string | null
  /** 封面文件的 media-type，用于在扩展名不可靠时推断格式。 */
  coverMediaType: string | null
  /** spine 条目数，即「章节数」，用于导入后立刻显示规模。 */
  spineLength: number
}

/**
 * 解析 OPF。title / creator / identifier 都可能缺失或写成多个，
 * 这里只做「尽力而为」的抽取，抽不到返回 null 由调用方决定兜底文案。
 */
export function parseOpfPackage(xml: string): EpubPackage | null {
  const pkg = childNode(parseXml(xml), 'package')
  if (!pkg) return null

  const metadata = childNode(pkg, 'metadata')
  const items = nodesNamed(childNode(pkg, 'manifest'), 'item')
  const coverItem = findCoverItem(metadata, items)

  return {
    title: textOf(metadata, 'title'),
    author: textOf(metadata, 'creator'),
    identifier: textOf(metadata, 'identifier'),
    coverHref: attributeOf(coverItem, 'href'),
    coverMediaType: attributeOf(coverItem, 'media-type'),
    spineLength: nodesNamed(childNode(pkg, 'spine'), 'itemref').length
  }
}

function findCoverItem(
  metadata: unknown,
  items: Record<string, unknown>[]
): Record<string, unknown> | undefined {
  const coverId = nodesNamed(metadata, 'meta')
    .filter((meta) => attributeOf(meta, 'name') === 'cover')
    .map((meta) => attributeOf(meta, 'content'))
    .find((content) => content !== null)

  const byId = coverId ? items.find((item) => attributeOf(item, 'id') === coverId) : undefined
  if (byId) return byId

  // EPUB 3 的标准做法：manifest item 上标 properties="cover-image"
  return items.find((item) => (attributeOf(item, 'properties') ?? '').split(/\s+/).includes('cover-image'))
}

export function extensionForImage(href: string, mediaType: string | null): string | null {
  const dotIndex = href.lastIndexOf('.')
  if (dotIndex >= 0) {
    const extension = href.slice(dotIndex + 1).toLowerCase()
    if (extension === 'jpeg') return 'jpg'
    if (Object.values(IMAGE_EXTENSIONS).includes(extension)) return extension
  }

  return mediaType === null ? null : (IMAGE_EXTENSIONS[mediaType.toLowerCase()] ?? null)
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 统一成 posix 风格、去掉首尾斜杠的 zip 内路径。 */
export function normalizeZipPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

/** OPF 所在目录（posix 风格），用于解析 manifest 里的相对路径。 */
export function dirnameOf(opfPath: string): string {
  const index = opfPath.lastIndexOf('/')
  return index < 0 ? '' : opfPath.slice(0, index)
}

/**
 * 把 href 解析成 zip 内的绝对路径。
 * 路径穿越（../ 跑到根之上）一律判定为非法，返回 null。
 */
export function resolveZipPath(baseDir: string, href: string): string | null {
  const withoutQuery = decodeSafe(href).split(/[?#]/, 1)[0] ?? ''
  const segments = [...(withoutQuery.startsWith('/') ? [] : baseDir.split('/')), ...withoutQuery.split('/')]
  const resolved: string[] = []

  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (resolved.length === 0) return null
      resolved.pop()
      continue
    }
    resolved.push(segment)
  }

  return resolved.length === 0 ? null : resolved.join('/')
}
