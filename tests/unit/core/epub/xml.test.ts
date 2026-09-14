import { describe, expect, it } from 'vitest'
import { attributeOf, childNode, nodesNamed, parseXml, textOf, textOfValue } from '@core/epub/xml'

const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

describe('parseXml', () => {
  it('解析出根节点并保留属性', () => {
    const root = parseXml(SAMPLE)

    expect(root).not.toBeNull()
    expect(attributeOf(childNode(root, 'container'), 'version')).toBe('1.0')
  })

  it('去掉命名空间前缀，让 dc:title 与 title 用同一个键取到', () => {
    const root = parseXml('<metadata xmlns:dc="x"><dc:title>三体</dc:title></metadata>')

    expect(textOf(childNode(root, 'metadata'), 'title')).toBe('三体')
  })

  it('内容为空或不是 XML 时返回 null 而不是抛错', () => {
    expect(parseXml('')).toBeNull()
    expect(parseXml('   ')).toBeNull()
    // fast-xml-parser 对残缺 XML 相当宽容，但自身抛错时必须被吞掉，不能让坏文件把应用打断
    expect(parseXml('<无关闭标签')).toBeNull()
  })

  it('标签值不会被自动转成数字，避免 08 变成 8', () => {
    const root = parseXml('<a><page>08</page><flag>true</flag></a>')

    expect(textOf(childNode(root, 'a'), 'page')).toBe('08')
    expect(textOf(childNode(root, 'a'), 'flag')).toBe('true')
  })
})

describe('childNode / nodesNamed', () => {
  const root = parseXml('<a><b id="1"/><b id="2"/><c id="3">x</c><d>纯文本</d></a>')

  it('childNode 取同名兄弟中的第一个', () => {
    expect(attributeOf(childNode(childNode(root, 'a'), 'b'), 'id')).toBe('1')
  })

  it('nodesNamed 把单个子节点也归一成数组', () => {
    expect(nodesNamed(childNode(root, 'a'), 'b')).toHaveLength(2)
    expect(nodesNamed(childNode(root, 'a'), 'c')).toHaveLength(1)
  })

  it('只有纯文本的叶子元素会被解析成字符串，不算节点（取文本请用 textOf）', () => {
    const parent = childNode(root, 'a')

    expect(nodesNamed(parent, 'd')).toEqual([])
    expect(textOf(parent, 'd')).toBe('纯文本')
  })

  it('节点不存在或传入非节点时返回空结果', () => {
    expect(childNode(childNode(root, 'a'), 'missing')).toBeNull()
    expect(childNode(null, 'b')).toBeNull()
    expect(childNode('text', 'b')).toBeNull()
    expect(nodesNamed(undefined, 'b')).toEqual([])
  })
})

describe('textOf / textOfValue', () => {
  it('取出被 #text 包装的文本（元素同时有属性和内容时会出现）', () => {
    const root = parseXml('<a><b id="x">正文</b></a>')

    expect(textOf(childNode(root, 'a'), 'b')).toBe('正文')
  })

  it('同名标签多次出现时取第一个非空值', () => {
    const root = parseXml('<m><creator/><creator>刘慈欣</creator></m>')

    expect(textOf(childNode(root, 'm'), 'creator')).toBe('刘慈欣')
  })

  it('去掉首尾空白，全空白视为没有值', () => {
    const root = parseXml('<m><title>\n  三体  \n</title><empty>   </empty></m>')

    expect(textOf(childNode(root, 'm'), 'title')).toBe('三体')
    expect(textOf(childNode(root, 'm'), 'empty')).toBeNull()
  })

  it('直接支持字符串、数字与嵌套结构', () => {
    expect(textOfValue('  值  ')).toBe('值')
    expect(textOfValue(12)).toBe('12')
    expect(textOfValue(true)).toBe('true')
    expect(textOfValue({ '#text': '内层' })).toBe('内层')
    expect(textOfValue(null)).toBeNull()
    expect(textOfValue({})).toBeNull()
  })
})

describe('attributeOf', () => {
  it('属性不存在时返回 null', () => {
    const node = childNode(parseXml('<a><b id="1"/></a>'), 'a')

    expect(attributeOf(node, 'id')).toBeNull()
    expect(attributeOf(childNode(node, 'b'), 'missing')).toBeNull()
  })

  it('空字符串属性被视为没有值', () => {
    const root = parseXml('<a><b id=""/></a>')

    expect(attributeOf(childNode(root, 'a'), 'id')).toBeNull()
  })
})
