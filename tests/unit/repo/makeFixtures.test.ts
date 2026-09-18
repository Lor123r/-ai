import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_TEXT_BYTES, TEXT_BLOCK_MAX_CHARS, normalizeNewlines, splitTextIntoBlocks } from '@core/domain/textBook'
import { MAX_BOOK_FILE_SIZE } from '../../../src/main/import/fileBookStore'

/**
 * 钉住 tools/make-fixtures.ps1 造出来的样本书。
 *
 * 这些样本是给人工逐条复核用的，平时没人会去打开它们 —— 于是脚本一旦悄悄写坏
 * （少写一个文件、行尾变回 LF、几本长文变成字节相同），复核的人只会得到一堆没法
 * 解释的结果，而问题其实出在样本本身。这份测试替那份清单记住「样本长什么样」：
 * 真的把脚本跑一遍，再拿 core 里真实的 splitTextIntoBlocks 复核产物。
 *
 * 清单里的字节数刻意只用来和实际文件大小对账，不用来判结构：那些数字是脚本自己写的，
 * 拿它核对等于让脚本给自己判卷。块数、行尾、去重这几条一律从字节重新算。
 */

// 与 tests/unit/repo/agentDefinitions.test.ts 同一个理由：测试都在包根执行，
// 不要改用 import.meta.url（模块作用域里读到的是错值且不报错）。
const repoRoot = process.cwd()
const scriptPath = join(repoRoot, 'tools', 'make-fixtures.ps1')

/** 复核清单里要覆盖的九条，缺一条就等于某次复核没有样本可看。 */
const REVIEW_ENTRIES = ['R21', 'R22', 'R23', 'R24', 'R25', 'R26', 'R27', 'R28', 'R29']

/** 长文那三本按行尾区分，靠文件名后缀挑出来。 */
const LINE_ENDINGS = ['LF', 'CRLF', 'CR']

interface ManifestSample {
  name: string
  serves: string[]
  bytes: number
}

interface Manifest {
  generatedBy: string
  outDir: string
  samples: ManifestSample[]
}

const isWindows = process.platform === 'win32'

describe.skipIf(!isWindows)('tools/make-fixtures.ps1', () => {
  let workDir = ''
  let dir = ''
  let manifest: Manifest

  // 只在 Windows 上跑得起来：脚本是 PowerShell，而且这些样本本来就是要喂给
  // Windows 桌面端的。这份测试守的是「脚本写出来的字节对不对」，不是脚本可移植性。
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'ebook-fixtures-'))
    dir = join(workDir, 'books')
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-OutDir', dir],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest
    // 20MB 的样本要写盘，默认 10s 的钩子超时在慢机器上不够。
  }, 120_000)

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  function bytesOf(name: string): Buffer {
    return readFileSync(join(dir, name))
  }

  function textOf(name: string): string {
    return bytesOf(name).toString('utf8')
  }

  function sampleServing(entry: string): ManifestSample[] {
    return manifest.samples.filter((sample) => sample.serves.includes(entry))
  }

  /** 按行尾后缀取出某一本长文，缺了就当场炸掉，省得后面拿到 undefined 再猜。 */
  function longBook(suffix: string): ManifestSample {
    const found = manifest.samples.find((sample) => sample.name.endsWith(`${suffix}.txt`))
    if (!found) throw new Error(`没有行尾为 ${suffix} 的长文样本`)
    return found
  }

  it('脚本自身是带 BOM 的 UTF-8，且不含 PS 5.1 不支持的语法', () => {
    const source = readFileSync(scriptPath)

    // PowerShell 5.1 会把没有 BOM 的文件按系统代码页（本机是 GBK）解析，注释里的
    // 中文全成乱码。BOM 是这个脚本能在 PS 5.1 下跑的前提，不是风格偏好。
    expect([...source.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])

    // 本机是 PS 5.1，&& 和 || 会被当成参数解析，脚本直接崩。
    expect(source.toString('utf8')).not.toMatch(/&&|\|\|/)
  })

  it('README 里给出了取样本的命令', () => {
    // 没有这一句，这个脚本对要复核的人等于不存在 —— 与 .claude/agents 那套
    // 「定义必须在 AGENTS.md 里被引用」是同一条约定。
    expect(readFileSync(join(repoRoot, 'README.md'), 'utf8')).toContain('tools/make-fixtures.ps1')
  })

  it('清单覆盖 R21–R29 每一条，样本都在且名字不重复', () => {
    const covered = new Set(manifest.samples.flatMap((sample) => sample.serves))
    expect(manifest.generatedBy).toBe('tools/make-fixtures.ps1')

    for (const entry of REVIEW_ENTRIES) {
      // 「有人声称服务它」和「文件真的写出来了」是两回事，两条都要过。
      expect([...covered], `${entry} 没有样本服务`).toContain(entry)
      for (const owner of sampleServing(entry)) {
        expect(existsSync(join(dir, owner.name)), `${owner.name} 没写出来`).toBe(true)
      }
    }

    const names = manifest.samples.map((sample) => sample.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('清单里的字节数与实际文件大小一致', () => {
    for (const sample of manifest.samples) {
      expect(statSync(join(dir, sample.name)).size, sample.name).toBe(sample.bytes)
    }
  })

  it('样本都是不带 BOM 的 UTF-8', () => {
    // 带 BOM 的话 decodeText 会按 BOM 直接判 UTF-8，把「没有 BOM 时怎么猜编码」
    // 整条回退路径绕过去，而这些样本的用处正在于压那条路径。
    for (const sample of manifest.samples) {
      if (sample.bytes === 0) continue
      expect([...bytesOf(sample.name).subarray(0, 3)], sample.name).not.toEqual([0xef, 0xbb, 0xbf])
    }
  })

  it('R21 越过 16MB 的解码闸门，但没越过 512MB 的书库上限', () => {
    // 两条边界合起来才是 R21 的判据：小于 16MB 根本不会触发提示，大于 512MB
    // 就进不了书架，也就没有「已导入却被拒打开」这个状态可看。
    const [sample] = sampleServing('R21')
    expect(sample.bytes).toBeGreaterThan(MAX_TEXT_BYTES)
    expect(sample.bytes).toBeLessThan(MAX_BOOK_FILE_SIZE)
  })

  it('R22 是 0 字节', () => {
    const [sample] = sampleServing('R22')
    expect(sample.bytes).toBe(0)
  })

  it('R23 非空却在排版阶段被判空', () => {
    // 与 R22 的区别就在这里：R22 在导入层就被拒（0 字节），R23 进得了书架，
    // 打开时才因为「没有可显示的文本」被拒 —— 两条提示文案对应两处不同的判据。
    const [sample] = sampleServing('R23')
    expect(sample.bytes).toBeGreaterThan(0)
    expect(splitTextIntoBlocks(textOf(sample.name))).toEqual([])
  })

  it('长文装成 6 块，块首比例正好是 R25 要的那串百分比', () => {
    for (const suffix of LINE_ENDINGS) {
      const blocks = splitTextIntoBlocks(textOf(longBook(suffix).name))
      // 6 块 → 块首比例 0/17/33/50/67/83（块内恒为 page=1，比例项为 0）。
      // 改段落数就要同步这里和 R25 清单，否则复核时拿到的是一串对不上的数字。
      expect(blocks, suffix).toHaveLength(6)
    }
  })

  it('三本长文行尾归一化后逐字相同', () => {
    const normalized = LINE_ENDINGS.map((suffix) => normalizeNewlines(textOf(longBook(suffix).name)))
    expect(normalized[1]).toBe(normalized[0])
    expect(normalized[2]).toBe(normalized[0])
  })

  it('三本长文的原始字节互不相同，导入时不会被按内容去重顶掉', () => {
    // 书库按 sha256 去重。三本字节一样的话，导入第三本只会得到「已在书架中」，
    // R26 的三条行尾对照就变成同一本书，比不出任何差别。
    const digests = LINE_ENDINGS.map((suffix) => bytesOf(longBook(suffix).name).toString('base64'))
    expect(new Set(digests).size).toBe(3)
  })

  it('CRLF 本只含 \\r\\n，CR 本只含孤立的 \\r', () => {
    const lf = textOf(longBook('LF').name)
    const crlf = textOf(longBook('CRLF').name)
    const cr = textOf(longBook('CR').name)

    expect(lf).not.toMatch(/\r/)
    expect(crlf.replace(/\r\n/g, '\n')).toBe(lf)
    expect(cr).not.toMatch(/\r\n/)
    expect(cr).toMatch(/\r/)
  })

  it('R27 单行超过 20 万字符，硬切成 3 块后收尾段落还在', () => {
    const [sample] = sampleServing('R27')
    const text = textOf(sample.name)
    const longest = Math.max(...normalizeNewlines(text).split('\n').map((line) => line.length))
    expect(longest).toBeGreaterThan(TEXT_BLOCK_MAX_CHARS)

    const blocks = splitTextIntoBlocks(text)
    // 三个硬切块（20 万 + 20 万 + 10 万）加收尾段落。
    expect(blocks).toHaveLength(4)
    // 每个块都不能超限 —— 超了排版那步会卡住，这正是硬切存在的理由。
    for (const block of blocks) expect(block.length).toBeLessThanOrEqual(TEXT_BLOCK_MAX_CHARS)
    expect(blocks[blocks.length - 1]).toContain('翻到最后一页')
  })

  it('R29 短到目录只能退化成按块列举', () => {
    const [sample] = sampleServing('R29')
    expect(splitTextIntoBlocks(textOf(sample.name))).toHaveLength(3)
  })
})
