import { access, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FILE_NAME = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/

/** 每条经验必须有的四节。缺一节就说明还没写清楚，见 docs/lessons/README.md。 */
const REQUIRED_SECTIONS = ['## 现象', '## 根因', '## 结论', '## 反例']

/**
 * 用 cwd 定位仓库根：`npm run test` / `npm run verify` 都在包根执行。
 * 不要改用 import.meta.url —— 在 vitest 里只有测试回调内联读到的那次才是本文件路径，
 * 在模块作用域或辅助函数里读到的是错值，而且不报错。
 */
const repoRoot = process.cwd()

function repoPath(...segments: string[]): string {
  return join(repoRoot, ...segments)
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function listLessonFiles(): Promise<string[]> {
  const names = await readdir(repoPath('docs', 'lessons'))
  return names.filter((name) => name.endsWith('.md') && name !== 'README.md').sort()
}

async function readLessons(): Promise<Array<{ fileName: string; source: string }>> {
  return Promise.all(
    (await listLessonFiles()).map(async (fileName) => ({
      fileName,
      source: await readFile(repoPath('docs', 'lessons', fileName), 'utf8')
    }))
  )
}

/**
 * 经验库的格式错误不会被任何工具报出来，只会让条目慢慢退化成散文，
 * 所以用测试钉住。顺带保证 docs/lessons 不是空目录（空目录无法被 Git 跟踪）。
 */
describe('docs/lessons 经验库', () => {
  it('至少存在一条经验', async () => {
    expect(await listLessonFiles()).not.toEqual([])
  })

  it('文件名是 NNNN-kebab-case.md', async () => {
    const invalid = (await listLessonFiles()).filter((name) => !FILE_NAME.test(name))
    expect(invalid).toEqual([])
  })

  it('编号连续且不重复', async () => {
    const numbers = (await listLessonFiles()).map((name) => Number(FILE_NAME.exec(name)![1]))

    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(numbers[0]).toBe(1)
    expect(numbers[numbers.length - 1]).toBe(numbers.length)
  })

  it('每条都有四节：现象 / 根因 / 结论 / 反例', async () => {
    const problems: string[] = []

    for (const { fileName, source } of await readLessons()) {
      const missing = REQUIRED_SECTIONS.filter((section) => !source.includes(section))
      if (missing.length > 0) problems.push(`${fileName}: 缺 ${missing.join('、')}`)
    }

    expect(problems).toEqual([])
  })

  it('标题以编号开头，与文件名一致', async () => {
    const problems: string[] = []

    for (const { fileName, source } of await readLessons()) {
      const number = FILE_NAME.exec(fileName)![1]
      const title = /^# (.+)$/m.exec(source)?.[1] ?? ''
      if (!title.startsWith(`${number} `)) problems.push(`${fileName}: 标题为「${title}」`)
    }

    expect(problems).toEqual([])
  })

  it('每条都在索引里被引用，避免加了却没人发现', async () => {
    const index = await readFile(repoPath('docs', 'lessons', 'README.md'), 'utf8')
    const unreferenced = (await listLessonFiles()).filter((name) => !index.includes(name))
    expect(unreferenced).toEqual([])
  })

  it('索引里的链接都指向真实存在的文件', async () => {
    const index = await readFile(repoPath('docs', 'lessons', 'README.md'), 'utf8')
    const linked = [...index.matchAll(/\]\(\.\/(\d{4}-[a-z0-9-]+\.md)\)/g)].map((m) => m[1]!)
    const existing = new Set(await listLessonFiles())

    expect(linked.filter((name) => !existing.has(name))).toEqual([])
  })

  it('AGENTS.md 指向经验库，否则 AI 不会主动去读', async () => {
    const agentsDoc = await readFile(repoPath('AGENTS.md'), 'utf8')
    expect(agentsDoc).toContain('docs/lessons')
  })

  it('AGENTS.md 与索引里的文档链接都指向真实存在的文件', async () => {
    const sources = [
      { name: 'AGENTS.md', source: await readFile(repoPath('AGENTS.md'), 'utf8'), base: repoRoot },
      {
        name: 'docs/lessons/README.md',
        source: await readFile(repoPath('docs', 'lessons', 'README.md'), 'utf8'),
        base: repoPath('docs', 'lessons')
      }
    ]

    const broken: string[] = []

    for (const { name, source, base } of sources) {
      for (const match of source.matchAll(/\]\((\.\.?\/[^)#]+\.md)\)/g)) {
        const target = join(base, match[1]!)
        if (!(await pathExists(target))) broken.push(`${name} → ${match[1]}`)
      }
    }

    expect(broken).toEqual([])
  })
})
