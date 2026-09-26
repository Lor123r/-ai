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

  it('写作规范要求结论限定范围并记录观测环境', async () => {
    const index = await readFile(repoPath('docs', 'lessons', 'README.md'), 'utf8')

    // 0015 翻车两次都是因为把「一个时间点的观测」写成「稳定的结论」。
    // 规范里必须留下这条，否则下一个人还会写全称判断。
    expect(index).toContain('不要写全称判断')
    expect(index).toContain('环境是变量，不是常量')
  })

  it('AGENTS.md 写明了什么时候必须追加经验，否则没人会写', async () => {
    const agentsDoc = await readFile(repoPath('AGENTS.md'), 'utf8')

    // 光说"踩到新坑就记"不可判定，AI 会永远认为自己没踩到。
    // 必须给出可对照的触发条件，并且明确"不满足就别写"。
    expect(agentsDoc).toContain('什么时候必须追加一条')
    expect(agentsDoc).toContain('不要写')
  })

  it('AGENTS.md 引用了经验库策展人，避免定义了却没人发现', async () => {
    const agentsDoc = await readFile(repoPath('AGENTS.md'), 'utf8')
    expect(agentsDoc).toContain('lessons-curator.md')
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
      // 注释块里的链接是给人看的示例（模板占位符等），不参与校验
      const visible = source.replace(/<!--[\s\S]*?-->/g, '')

      for (const match of visible.matchAll(/\]\((\.\.?\/[^)#]+\.md)\)/g)) {
        const target = join(base, match[1]!)
        if (!(await pathExists(target))) broken.push(`${name} → ${match[1]}`)
      }
    }

    expect(broken).toEqual([])
  })
})
