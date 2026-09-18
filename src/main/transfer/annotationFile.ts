import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { ANNOTATION_EXPORT_BOUNDARY_MESSAGE } from '@shared/ipc'

/**
 * 注解导入文件的大小上限。注解本身很小，到这个量级只可能是选错了文件（整本电子书、
 * 视频），提前拦住比读进来再失败友好。
 *
 * 上限放在这里而不是 core：core 不得碰 fs，连 stat 都做不了，没有位置能拦住 readFile。
 */
export const MAX_ANNOTATION_FILE_SIZE = 8 * 1024 * 1024

/** 导出目标落在应用数据目录里时抛出。 */
export class AnnotationFileBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnnotationFileBoundaryError'
  }
}

export function isAnnotationFileBoundaryError(error: unknown): error is AnnotationFileBoundaryError {
  return error instanceof AnnotationFileBoundaryError
}

/** 书名洗不出可用的文件名时的回落。 */
export const UNTITLED_BOOK_TITLE = '未命名书籍'

const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|]/g
const MAX_FILE_NAME_STEM = 60

/**
 * 另存框的默认文件名。
 *
 * 书名来自书库文件，可以是「三体/全集」这类在 Windows 上根本存不下去的名字，所以按
 * 文件名规则洗一遍：非法字符换成空格、连续空白合并、掐掉结尾的点和空格（Windows 会
 * 把它们静默丢掉，剩下 `三体.` 这种和实际存下的路径对不上号的 defaultPath），再限长。
 * 洗完什么都不剩就回落一个固定名字，绝不让 defaultPath 变成 `.json`。
 *
 * 截断之后要再掐一次尾：第 60 个字符正好落在分隔符上时，第一轮的规则管不到。
 */
export function annotationFileName(title: string): string {
  const cleaned = title
    .replace(UNSAFE_FILE_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')

  const stem = cleaned
    .slice(0, MAX_FILE_NAME_STEM)
    .trim()
    .replace(/[. ]+$/, '')

  return `${stem.length > 0 ? stem : UNTITLED_BOOK_TITLE}-注解.json`
}

/**
 * 读入用户选中的注解文件。
 *
 * 先 stat 再 read，而不是读回来再量长度：上限的意义是「别把一个 G 的文件读进内存」，
 * 读完才知道超了就已经白读了。
 */
export async function readAnnotationText(
  path: string,
  maxBytes: number = MAX_ANNOTATION_FILE_SIZE
): Promise<string> {
  const info = await stat(path)

  if (!info.isFile()) throw new Error('导入的目标不是普通文件')
  if (info.size > maxBytes) throw new Error('注解文件超过了大小上限')

  return readFile(path, 'utf8')
}

export interface WriteAnnotationTextOptions {
  /**
   * 不允许写入的目录：应用自己的数据目录。
   *
   * 导出目标默认落在文档目录，但用户完全可以手动把另存框的路径改到应用数据目录里。
   * 那不叫导出，那叫拿一份手改过的文件覆盖应用自己的存档 —— 被覆盖掉的是用户全部的
   * 笔记。这里只挡应用自己的数据目录，不限制其它任何位置。
   */
  mustStayOutside: string
  /** 临时文件的随机后缀，测试里钉住用。 */
  tempSuffix?: string
}

/**
 * 把注解文件写到用户选定的位置。
 *
 * 保留「先写临时文件再改名」：这不是应用自己的存档，而是用户的笔记文件，写到一半被
 * 强杀会留下一个坏掉的、看起来已经成功的 json。失败路径要把临时文件删掉，否则用户
 * 重复导出几次会在自己选的目录里攒下一堆垃圾。
 *
 * 临时文件带随机后缀而不是固定的 `.tmp`：同一本书连点两次导出，两个写盘过程会互相
 * 覆盖临时文件，最后 rename 出来的内容可能来自另一次导出。
 */
export async function writeAnnotationText(
  target: string,
  text: string,
  options: WriteAnnotationTextOptions
): Promise<void> {
  requireOutside(options.mustStayOutside, target)

  const tempPath = `${target}.${options.tempSuffix ?? randomUUID()}.tmp`

  try {
    await writeFile(tempPath, text, 'utf8')
    await rename(tempPath, target)
  } catch (caught) {
    // 清理失败不能盖掉真正的失败原因：临时文件删不掉只是留下一点垃圾，
    // 而原始错误才是用户需要看到的那一个
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw caught
  }
}

/** 目标既不能落在 root 内，也不能就是 root 本身。 */
function requireOutside(root: string, target: string): void {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)

  if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new AnnotationFileBoundaryError(ANNOTATION_EXPORT_BOUNDARY_MESSAGE)
  }
}
