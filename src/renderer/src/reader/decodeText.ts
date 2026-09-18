/**
 * 正文字节解码。TXT 没有格式规范约束编码，用户手里的中文 TXT 相当一部分是
 * GBK/GB18030，只认 UTF-8 等于让一半的文件打不开。
 *
 * 顺序：BOM 优先（BOM 是文件自己声明的编码，比任何启发式都可靠）→
 * fatal 的 UTF-8（解不开就说明不是 UTF-8，而不是「解出乱码」）→
 * GB18030（覆盖 GBK/GB2312，是中文 Windows 的默认码页）→
 * 非 fatal 的 UTF-8（兜底，坏字节变成 U+FFFD，但绝不抛异常）。
 *
 * 刻意不做换行归一化：那是 splitTextIntoBlocks 的职责，两处都做会让
 * 「空行分段」这条规则有两个实现，早晚会分叉。
 *
 * 已知边界：没有 BOM 的 UTF-16 会被当成 UTF-8 解成夹 NUL 的串。Windows 记事本
 * 存 UTF-16 一定会写 BOM，这种文件在实践中不存在，不为它加 NUL 密度启发式。
 */
export function decodeTextBytes(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return ''

  const bom = detectBom(bytes)
  if (bom !== null) return decodeLenient(bom.encoding, bytes.subarray(bom.length))

  const strict = decodeStrict(bytes)
  if (strict !== null) return strict

  const gb = decodeLenient('gb18030', bytes)
  if (gb !== '') return gb

  // 连 gb18030 都建不起来（宿主没带这张表）时才走到这里
  return decodeLenient('utf-8', bytes)
}

interface Bom {
  encoding: string
  length: number
}

function detectBom(bytes: Uint8Array): Bom | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', length: 3 }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', length: 2 }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', length: 2 }
  return null
}

/** 严格模式解不开就返回 null，交给调用方试下一种编码。 */
function decodeStrict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** 宽容解码：坏字节变 U+FFFD，不抛异常；连编码名都不认识时返回空串。 */
function decodeLenient(label: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return ''
  }
}
