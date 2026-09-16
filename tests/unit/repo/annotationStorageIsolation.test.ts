import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用 cwd 定位仓库根：`npm run test` / `npm run verify` 都在包根执行。
 * 不要改用 import.meta.url —— 在 vitest 里只有测试回调内联读到的那次才是本文件路径，
 * 在模块作用域或辅助函数里读到的是错值，而且不报错。
 */
const repoRoot = process.cwd()

function readSource(...segments: string[]): Promise<string> {
  return readFile(join(repoRoot, ...segments), 'utf8')
}

/**
 * 这条守卫钉的是「注解存档的恢复绝不能顺手复用书库的备份逻辑」。
 * 两边各有一个损坏备份流程，看起来几乎一样，但书库那边的实现备份失败后会再读一次，
 * 一旦被复用到注解这边，坏文件就会二次抛错并让窗口起不来。
 * 只要有人把书库的路径或常量硬编码回注解这边，这条断言就会红。
 */
describe('注解存档与书库的源码隔离', () => {
  it('注解存档的实现里不出现任何书库字样', async () => {
    const source = await readSource('src', 'main', 'storage', 'annotations.ts')

    expect(source.match(/library/gi)).toEqual(null)
  })

  it('书库的实现里不出现任何注解字样', async () => {
    const source = await readSource('src', 'main', 'storage', 'library.ts')

    expect(source.match(/annotation/gi)).toEqual(null)
  })

  it('两份存档各自用各自的文件名', async () => {
    const annotationsSource = await readSource('src', 'main', 'storage', 'annotations.ts')

    expect(annotationsSource).toContain('annotations.json')
  })
})
