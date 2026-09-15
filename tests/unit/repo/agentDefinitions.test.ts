import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 用 cwd 定位仓库根：`npm run test` / `npm run verify` 都在包根执行。
 * 不要改用 import.meta.url —— 在 vitest 里只有测试回调内联读到的那次才是本文件路径，
 * 在模块作用域或辅助函数里读到的是错值，而且不报错。
 */
const repoRoot = process.cwd()

function repoPath(...segments: string[]): string {
  return join(repoRoot, ...segments)
}

/** 只解析 frontmatter 里的顶层 `key: value`，避免为一个字段引入 YAML 依赖。 */
function parseFrontmatter(source: string): Record<string, string> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)
  if (block === null) return {}

  const fields: Record<string, string> = {}
  for (const line of block[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return fields
}

async function listAgentFiles(): Promise<string[]> {
  const names = await readdir(repoPath('.claude', 'agents'))
  return names.filter((name) => name.endsWith('.md')).sort()
}

async function readAgentFields(): Promise<
  Array<{ fileName: string; fields: Record<string, string> }>
> {
  return Promise.all(
    (await listAgentFiles()).map(async (fileName) => ({
      fileName,
      fields: parseFrontmatter(
        await readFile(repoPath('.claude', 'agents', fileName), 'utf8')
      )
    }))
  )
}

/**
 * 子 Agent 定义的格式错误不会被任何工具报出来，只会静默不生效，所以用测试钉住。
 * 顺带保证 .claude/agents 不是空目录（空目录无法被 Git 跟踪）。
 */
describe('.claude/agents 子 Agent 定义', () => {
  it('至少存在一个定义', async () => {
    expect(await listAgentFiles()).not.toEqual([])
  })

  it('文件名是小写 kebab-case', async () => {
    const invalid = (await listAgentFiles()).filter(
      (name) => !KEBAB_CASE.test(name.replace(/\.md$/, ''))
    )
    expect(invalid).toEqual([])
  })

  it('每个定义都有 name 与 description，且 name 与文件名一致', async () => {
    const problems: string[] = []

    for (const { fileName, fields } of await readAgentFields()) {
      const stem = fileName.replace(/\.md$/, '')
      if (fields.name !== stem) problems.push(`${fileName}: name=${fields.name ?? '(缺失)'}`)
      if ((fields.description ?? '').length === 0) problems.push(`${fileName}: description 缺失`)
    }

    expect(problems).toEqual([])
  })

  it('name 不重复', async () => {
    const names = (await readAgentFields())
      .map(({ fields }) => fields.name)
      .filter((name) => name !== undefined)

    expect(names).toHaveLength(new Set(names).size)
  })

  it('每个定义都在 AGENTS.md 里被引用，避免加了却没人发现', async () => {
    const agentsDoc = await readFile(repoPath('AGENTS.md'), 'utf8')
    const unreferenced = (await listAgentFiles()).filter((name) => !agentsDoc.includes(name))
    expect(unreferenced).toEqual([])
  })
})
