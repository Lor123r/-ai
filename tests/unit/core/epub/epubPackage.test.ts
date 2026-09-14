import { describe, expect, it } from 'vitest'
import {
  dirnameOf,
  extensionForImage,
  normalizeZipPath,
  parseContainerXml,
  parseOpfPackage,
  resolveZipPath
} from '@core/epub/epubPackage'

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

function opf(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
${body}
</package>`
}

const BASIC_OPF = opf(`
  <metadata>
    <dc:title>三体</dc:title>
    <dc:creator>刘慈欣</dc:creator>
    <dc:identifier id="bookid">urn:uuid:1</dc:identifier>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine>
`)

describe('parseContainerXml', () => {
  it('取出 OPF 路径', () => {
    expect(parseContainerXml(CONTAINER)).toBe('OEBPS/content.opf')
  })

  it('路径带前导斜杠或反斜杠时归一化', () => {
    const xml = '<container><rootfiles><rootfile full-path="\\OEBPS\\content.opf"/></rootfiles></container>'

    expect(parseContainerXml(xml)).toBe('OEBPS/content.opf')
  })

  it('缺少 rootfile 或 full-path 时返回 null', () => {
    expect(parseContainerXml('<container><rootfiles/></container>')).toBeNull()
    expect(parseContainerXml('<container><rootfiles><rootfile/></rootfiles></container>')).toBeNull()
    expect(parseContainerXml('不是 XML')).toBeNull()
  })
})

describe('parseOpfPackage', () => {
  it('抽取书名、作者、标识与章节数', () => {
    const pkg = parseOpfPackage(BASIC_OPF)

    expect(pkg).toMatchObject({
      title: '三体',
      author: '刘慈欣',
      identifier: 'urn:uuid:1',
      coverHref: 'images/cover.jpg',
      coverMediaType: 'image/jpeg',
      spineLength: 2
    })
  })

  it('支持 EPUB 3 用 properties="cover-image" 声明封面', () => {
    const pkg = parseOpfPackage(
      opf(`
        <metadata><dc:title>书</dc:title></metadata>
        <manifest>
          <item id="x" href="cover.png" media-type="image/png" properties="cover-image"/>
        </manifest>
        <spine><itemref idref="x"/></spine>
      `)
    )

    expect(pkg).toMatchObject({ coverHref: 'cover.png', coverMediaType: 'image/png' })
  })

  it('meta[name=cover] 指向不存在的 manifest 项时回落到 properties 声明', () => {
    const pkg = parseOpfPackage(
      opf(`
        <metadata><meta name="cover" content="不存在"/></metadata>
        <manifest><item id="real" href="c.png" media-type="image/png" properties="cover-image"/></manifest>
        <spine/>
      `)
    )

    expect(pkg?.coverHref).toBe('c.png')
  })

  it('没有封面时 coverHref 为 null', () => {
    const pkg = parseOpfPackage(
      opf(`
        <metadata><dc:title>无封面</dc:title></metadata>
        <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="c1"/></spine>
      `)
    )

    expect(pkg).toMatchObject({ title: '无封面', coverHref: null, coverMediaType: null, spineLength: 1 })
  })

  it('元数据缺失的字段返回 null，不编造内容', () => {
    const pkg = parseOpfPackage(opf('<metadata/><manifest/><spine/>'))

    expect(pkg).toMatchObject({ title: null, author: null, identifier: null, spineLength: 0 })
  })

  it('不是 package 根节点时返回 null', () => {
    expect(parseOpfPackage('<html><body/></html>')).toBeNull()
    expect(parseOpfPackage('')).toBeNull()
  })
})

describe('normalizeZipPath / dirnameOf', () => {
  it('归一化反斜杠与前导 ./', () => {
    expect(normalizeZipPath('\\OEBPS\\content.opf')).toBe('OEBPS/content.opf')
    expect(normalizeZipPath('./OEBPS/content.opf')).toBe('OEBPS/content.opf')
    expect(normalizeZipPath('/OEBPS/content.opf')).toBe('OEBPS/content.opf')
  })

  it('取所在目录，根目录下返回空串', () => {
    expect(dirnameOf('OEBPS/text/content.opf')).toBe('OEBPS/text')
    expect(dirnameOf('content.opf')).toBe('')
  })
})

describe('resolveZipPath', () => {
  it('把 href 解析成相对 OPF 目录的绝对路径', () => {
    expect(resolveZipPath('OEBPS', 'images/cover.jpg')).toBe('OEBPS/images/cover.jpg')
    expect(resolveZipPath('OEBPS/text', '../images/cover.jpg')).toBe('OEBPS/images/cover.jpg')
    expect(resolveZipPath('', 'cover.jpg')).toBe('cover.jpg')
    expect(resolveZipPath('OEBPS', './Images/../Images/a.png')).toBe('OEBPS/Images/a.png')
  })

  it('支持绝对路径与 URL 编码', () => {
    expect(resolveZipPath('OEBPS/text', '/images/a b.png')).toBe('images/a b.png')
    expect(resolveZipPath('OEBPS', 'images/%E5%B0%81%E9%9D%A2.png')).toBe('OEBPS/images/封面.png')
  })

  it('路径穿越到书库之外时返回 null', () => {
    expect(resolveZipPath('OEBPS', '../../../../etc/passwd')).toBeNull()
    expect(resolveZipPath('', '../secret')).toBeNull()
  })

  it('忽略查询串与锚点，空结果返回 null', () => {
    expect(resolveZipPath('OEBPS', 'a.png?v=2#x')).toBe('OEBPS/a.png')
    expect(resolveZipPath('', '')).toBeNull()
    // './' 解析结果就是 OPF 所在目录本身，后续按文件读取时会取不到内容
    expect(resolveZipPath('OEBPS', './')).toBe('OEBPS')
  })
})

describe('extensionForImage', () => {
  it('优先用扩展名，jpeg 统一成 jpg', () => {
    expect(extensionForImage('a/b/cover.PNG', null)).toBe('png')
    expect(extensionForImage('cover.jpeg', 'image/jpeg')).toBe('jpg')
  })

  it('扩展名不可用时回落到 media-type', () => {
    expect(extensionForImage('cover', 'image/webp')).toBe('webp')
    expect(extensionForImage('cover.bin', 'image/gif')).toBe('gif')
  })

  it('既认不出扩展名也认不出 media-type 时返回 null', () => {
    expect(extensionForImage('cover.exe', 'application/octet-stream')).toBeNull()
    expect(extensionForImage('cover', null)).toBeNull()
  })
})
