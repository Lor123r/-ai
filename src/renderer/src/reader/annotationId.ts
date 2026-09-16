/**
 * 注解 id 的生成。
 *
 * core 约定「id 由渲染层生成，主进程只校验」，所以这里产出的每一个分支都必须落在
 * core 的白名单内（长度 ≤ 128、字符集 [A-Za-z0-9_-]），否则主进程会直接拒绝落盘。
 */

/**
 * 回退路径的随机字节数。16 字节转成 32 个十六进制字符，
 * 既远低于 core 的 128 字符上限，也留够了防撞车的空间。
 */
const FALLBACK_ID_BYTES = 16

const HEX_RADIX = 16

/** 取出平台提供的 WebCrypto；被裁剪掉的环境里可能整个不存在。 */
function getWebCrypto(): Crypto | undefined {
  return typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function randomHex(byteLength: number): string {
  let hex = ''
  while (hex.length < byteLength * 2) {
    hex += Math.floor(Math.random() * HEX_RADIX).toString(HEX_RADIX)
  }
  return hex
}

/**
 * 生成一条新的注解 id，三档依次降级：
 *
 * 1. `crypto.randomUUID()`：标准 UUID，连字符也在白名单内；
 * 2. `crypto.getRandomValues()`：`randomUUID` 是安全上下文限定的接口，而它不是，
 *    所以非安全上下文下正好由这一档接手；
 * 3. `Math.random()`：连 WebCrypto 都没有时的兜底。
 *
 * 三档都必须随机，不能退到递增计数器：同一个 (bookId, id) 在存档里是覆盖语义，
 * id 撞车等于两条注解悄悄合成一条，而计数器在「重装 / 换设备 / 清空存档」之后
 * 一定会从同一个起点重新走一遍。
 *
 * 第 3 档不是密码学随机数。注解 id 不需要不可预测性，只需要不撞车，128 位空间对
 * 单机书架绰绰有余；相比之下，在这里抛错会让用户直接做不成标注。
 */
export function createAnnotationId(): string {
  const webCrypto = getWebCrypto()

  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }

  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    return toHex(webCrypto.getRandomValues(new Uint8Array(FALLBACK_ID_BYTES)))
  }

  return randomHex(FALLBACK_ID_BYTES)
}
