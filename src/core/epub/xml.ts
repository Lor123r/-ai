import { XMLParser } from 'fast-xml-parser'

/** 解析后的节点：属性以 `@_` 前缀的键存放，文本可能包在 `#text` 里。 */
export type XmlNode = Record<string, unknown>

export const TEXT_NODE = '#text'
export const ATTRIBUTE_PREFIX = '@_'

/**
 * 所有值都按字符串处理：EPUB 里的日期、版本号、页码往往带前导零，
 * 让解析器自动转数字反而会把 `08` 变成 8 而丢失原始信息。
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  allowBooleanAttributes: true
})

function isRecord(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析 XML；非法内容不抛异常而是返回 null，让调用方走「导入失败」分支。 */
export function parseXml(xml: string): XmlNode | null {
  if (typeof xml !== 'string' || xml.trim() === '') return null

  try {
    const parsed: unknown = parser.parse(xml)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function childNode(node: unknown, name: string): XmlNode | null {
  if (!isRecord(node)) return null

  const value = node[name]
  if (isRecord(value)) return value

  return Array.isArray(value) ? (value.find(isRecord) ?? null) : null
}

export function nodesNamed(node: unknown, name: string): XmlNode[] {
  if (!isRecord(node)) return []

  const value = node[name]
  if (Array.isArray(value)) return value.filter(isRecord)
  return isRecord(value) ? [value] : []
}

export function attributeOf(node: unknown, name: string): string | null {
  if (!isRecord(node)) return null
  return textOfValue(node[ATTRIBUTE_PREFIX + name])
}

/** 取子元素文本；同一个标签出现多次时取第一个非空值。 */
export function textOf(node: unknown, name: string): string | null {
  if (!isRecord(node)) return null
  return textOfValue(node[name])
}

export function textOfValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textOfValue(item)
      if (text !== null) return text
    }
    return null
  }

  if (isRecord(value)) return textOfValue(value[TEXT_NODE])
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return null
}
