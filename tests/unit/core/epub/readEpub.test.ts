import { describe, expect, it } from 'vitest'
import { readEpub } from '@core/epub/readEpub'
import { buildEpubBytes, buildZipBytes, FAKE_PNG_BYTES } from '../../../support/epubFixture'

describe('readEpub', () => {
  it('读出一本书的书名、作者、标识、章节数与封面', async () => {
    const metadata = await readEpub(
      await buildEpubBytes({ title: '三体', author: '刘慈欣', identifier: 'urn:uuid:1', spineItems: 3 })
    )

    expect(metadata).toMatchObject({
      title: '三体',
      author: '刘慈欣',
      identifier: 'urn:uuid:1',
      spineLength: 3
    })
    expect(metadata?.cover?.extension).toBe('png')
    expect(Array.from(metadata?.cover?.bytes ?? [])).toEqual(Array.from(FAKE_PNG_BYTES))
  })

  it('缺书名作者时返回 null 而不报错，由调用方兜底', async () => {
    const metadata = await readEpub(await buildEpubBytes({ title: null, author: null, identifier: null }))

    expect(metadata).toMatchObject({ title: null, author: null, identifier: null })
  })

  it('封面写在子目录里也能按相对路径找到', async () => {
    const metadata = await readEpub(
      await buildEpubBytes({
        opfPath: 'EPUB/package.opf',
        coverHref: 'assets/img/cover.jpeg',
        coverMediaType: 'image/jpeg'
      })
    )

    expect(metadata?.cover?.extension).toBe('jpg')
  })

  it('支持 EPUB 3 的 properties="cover-image" 写法', async () => {
    const metadata = await readEpub(await buildEpubBytes({ coverStyle: 'properties' }))

    expect(metadata?.cover?.extension).toBe('png')
  })

  it('没有封面时 cover 为 null', async () => {
    const metadata = await readEpub(await buildEpubBytes({ coverStyle: 'none' }))

    expect(metadata?.cover).toBeNull()
  })

  it('封面路径穿越到 zip 之外时忽略封面，其余元数据照常读出', async () => {
    const metadata = await readEpub(await buildEpubBytes({ coverHref: '../../../etc/passwd.png' }))

    expect(metadata?.title).toBe('测试书名')
    expect(metadata?.cover).toBeNull()
  })

  it('封面文件是空文件时视为没有封面', async () => {
    const metadata = await readEpub(await buildEpubBytes({ coverBytes: new Uint8Array(0) }))

    expect(metadata?.cover).toBeNull()
  })

  it('缺少 container.xml 时扫描 zip 找 .opf，仍然能读出来', async () => {
    const metadata = await readEpub(await buildEpubBytes({ includeContainer: false, title: '无入口的书' }))

    expect(metadata?.title).toBe('无入口的书')
  })

  it('封面扩展名与媒体类型都认不出时忽略封面', async () => {
    const metadata = await readEpub(
      await buildEpubBytes({ coverHref: 'images/cover.bin', coverMediaType: 'application/octet-stream' })
    )

    expect(metadata?.title).toBe('测试书名')
    expect(metadata?.cover).toBeNull()
  })

  it('不是 zip 的字节返回 null 而不是抛错', async () => {
    await expect(readEpub(new TextEncoder().encode('这不是 zip'))).resolves.toBeNull()
    await expect(readEpub(new Uint8Array(0))).resolves.toBeNull()
  })

  it('是 zip 但没有 OPF 时返回 null', async () => {
    await expect(readEpub(await buildZipBytes({ 'readme.txt': 'hello' }))).resolves.toBeNull()
  })

  it('OPF 内容损坏（不是 package）时返回 null', async () => {
    const bytes = await buildZipBytes({
      'META-INF/container.xml':
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="a.opf"/></rootfiles></container>',
      'a.opf': '<html><body>不是 package</body></html>'
    })

    await expect(readEpub(bytes)).resolves.toBeNull()
  })
})
