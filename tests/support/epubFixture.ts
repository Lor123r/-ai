import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import JSZip from 'jszip'

export const FAKE_PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

export interface EpubNavItem {
  label: string
  /** 相对导航文档的 href，可带 #fragment。 */
  href: string
  subitems?: EpubNavItem[]
}

export interface EpubFixtureOptions {
  title?: string | null
  author?: string | null
  identifier?: string | null
  /** meta[name=cover] 是 EPUB 2 写法，properties="cover-image" 是 EPUB 3 写法。 */
  coverStyle?: 'meta' | 'properties' | 'none'
  /** 故意写一个越界路径，用来验证路径穿越会被拒绝。 */
  coverHref?: string
  coverMediaType?: string
  coverBytes?: Uint8Array
  spineItems?: number
  /** OPF 在 zip 内的位置，换个目录可验证相对路径解析。 */
  opfPath?: string
  /** 不写 container.xml，验证「没有标准入口也能靠扫描 .opf 读出来」。 */
  includeContainer?: boolean
  /** 提供后生成 EPUB 3 导航文档 nav.xhtml，并在 manifest 里标 properties="nav"。 */
  navItems?: EpubNavItem[]
}

function joinPath(...parts: string[]): string {
  return parts.filter((part) => part !== '').join('/')
}

/**
 * 用 JSZip 现场拼一个最小可用的 EPUB。
 * 测试里现造而不是提交二进制 fixture，改了结构就能立刻反映到断言上，
 * 而且能轻易造出各种残缺版本（缺 container、缺书名、路径越界）。
 */
export async function buildEpubBytes(options: EpubFixtureOptions = {}): Promise<Uint8Array> {
  const opfPath = options.opfPath ?? 'OEBPS/content.opf'
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
  const coverHref = options.coverHref ?? 'images/cover.png'
  const coverMediaType = options.coverMediaType ?? 'image/png'
  const coverStyle = options.coverStyle ?? 'meta'
  const chapterCount = options.spineItems ?? 2
  const navItems = options.navItems ?? null

  const zip = new JSZip()

  for (let index = 0; index < chapterCount; index += 1) {
    zip.file(joinPath(opfDir, `chapter${index + 1}.xhtml`), chapterDocument(index))
  }

  const manifest = Array.from({ length: chapterCount }, (_, index) => {
    const id = `chapter${index + 1}`
    return `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`
  })

  const spine = Array.from({ length: chapterCount }, (_, index) => `<itemref idref="chapter${index + 1}"/>`)

  if (coverStyle !== 'none') {
    const properties = coverStyle === 'properties' ? ' properties="cover-image"' : ''
    manifest.push(
      `<item id="cover-image" href="${coverHref}" media-type="${coverMediaType}"${properties}/>`
    )
    // 越界路径不写进 zip：解析阶段就该被拒绝，不需要真的有这个文件
    if (!coverHref.split('/').includes('..')) {
      zip.file(joinPath(opfDir, coverHref), options.coverBytes ?? FAKE_PNG_BYTES)
    }
  }

  if (navItems) {
    // epub.js 只认 properties 严格等于 "nav" 的 manifest 项
    manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`)
    zip.file(joinPath(opfDir, 'nav.xhtml'), navDocument(navItems))
  }

  const metadata = [
    options.title === null ? '' : `<dc:title>${options.title ?? '测试书名'}</dc:title>`,
    options.author === null ? '' : `<dc:creator>${options.author ?? '测试作者'}</dc:creator>`,
    options.identifier === null ? '' : `<dc:identifier>${options.identifier ?? 'urn:uuid:test'}</dc:identifier>`,
    coverStyle === 'meta' ? '<meta name="cover" content="cover-image"/>' : ''
  ]
    .filter((line) => line !== '')
    .join('')

  zip.file(
    opfPath,
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="${navItems ? '3.0' : '2.0'}" unique-identifier="bookid">
  <metadata>${metadata}</metadata>
  <manifest>${manifest.join('')}</manifest>
  <spine>${spine.join('')}</spine>
</package>`
  )

  if (options.includeContainer !== false) {
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    )
  }

  return zip.generateAsync({ type: 'uint8array' })
}

/** 把 EPUB 写到磁盘，导入流程的测试与 E2E 都需要一个真实文件。 */
export async function buildEpubFile(filePath: string, options: EpubFixtureOptions = {}): Promise<string> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, await buildEpubBytes(options))
  return filePath
}

/** 生成任意结构的 zip 字节，用来制造「是 zip 但不是 EPUB」这类坏文件。 */
export async function buildZipBytes(entries: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(entries)) zip.file(name, content)
  return zip.generateAsync({ type: 'uint8array' })
}

/** 把任意结构的 zip 落到磁盘。 */
export async function buildZipFile(filePath: string, entries: Record<string, string>): Promise<string> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, await buildZipBytes(entries))
  return filePath
}

function chapterDocument(index: number): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第 ${index + 1} 章</title></head>
<body><p>第 ${index + 1} 章正文</p></body></html>`
}

function navDocument(items: EpubNavItem[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>目录</h1>${navList(items)}</nav>
</body></html>`
}

function navList(items: EpubNavItem[]): string {
  const entries = items
    .map((item) => {
      const nested = item.subitems && item.subitems.length > 0 ? navList(item.subitems) : ''
      return `<li><a href="${item.href}">${item.label}</a>${nested}</li>`
    })
    .join('')
  return `<ol>${entries}</ol>`
}
