import JSZip from 'jszip'
import {
  CONTAINER_PATH,
  dirnameOf,
  extensionForImage,
  normalizeZipPath,
  parseContainerXml,
  parseOpfPackage,
  resolveZipPath
} from './epubPackage'

export interface EpubCover {
  bytes: Uint8Array
  /** 规范化后的扩展名，如 png / jpg。 */
  extension: string
}

export interface EpubMetadata {
  title: string | null
  author: string | null
  identifier: string | null
  spineLength: number
  cover: EpubCover | null
}

/**
 * 读取 EPUB 元数据与封面。
 * 只依赖字节内容，不碰文件系统，因此可以在测试里直接喂内存数据。
 * 不是合法的 EPUB（不是 zip、缺少 container.xml 或 OPF）时返回 null，
 * 由调用方转成「导入失败」提示，而不是让应用崩掉。
 */
export async function readEpub(bytes: Uint8Array): Promise<EpubMetadata | null> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    return null
  }

  const opfPath = await locateOpfPath(zip)
  if (opfPath === null) return null

  const opfFile = zip.file(opfPath)
  if (!opfFile) return null

  const parsed = parseOpfPackage(await opfFile.async('string'))
  if (!parsed) return null

  return {
    title: parsed.title,
    author: parsed.author,
    identifier: parsed.identifier,
    spineLength: parsed.spineLength,
    cover: await readCover(zip, opfPath, parsed.coverHref, parsed.coverMediaType)
  }
}

/** 优先按标准位置找 OPF，找不到再扫描一遍 zip 里的 .opf，兼容不规范但能读的书。 */
async function locateOpfPath(zip: JSZip): Promise<string | null> {
  const containerFile = zip.file(CONTAINER_PATH)
  if (containerFile) {
    const containerPath = parseContainerXml(await containerFile.async('string'))
    if (containerPath !== null && zip.file(containerPath)) return containerPath
  }

  const candidates = Object.keys(zip.files)
    .map(normalizeZipPath)
    .filter((path) => path.toLowerCase().endsWith('.opf'))
    .sort()

  return candidates[0] ?? null
}

async function readCover(
  zip: JSZip,
  opfPath: string,
  href: string | null,
  mediaType: string | null
): Promise<EpubCover | null> {
  if (href === null) return null

  const coverPath = resolveZipPath(dirnameOf(opfPath), href)
  if (coverPath === null) return null

  const extension = extensionForImage(coverPath, mediaType)
  if (extension === null) return null

  const file = zip.file(coverPath)
  if (!file) return null

  const bytes = await file.async('uint8array')
  return bytes.byteLength === 0 ? null : { bytes, extension }
}
