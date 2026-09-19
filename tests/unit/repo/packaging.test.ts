import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 钉住打包配置。
 *
 * 打包这件事没法进 `npm run verify`：electron-builder 要下载二进制、跑一次是分钟级，
 * 而且产物正确性只能人工双击验证。于是「配置写对了」很容易退化成一句纸面结论 ——
 * 直到某天有人改了 `files` 把 `src/` 打进产物，或者把 `main` 指错，才发现包是坏的。
 *
 * 这份测试只钉那些**改错了必然出问题、且不需要真的打包就能判断**的约束。
 */

// 与 tests/unit/repo/agentDefinitions.test.ts 同一个理由：测试都在包根执行，
// 不要改用 import.meta.url（模块作用域里读到的是错值且不报错）。
const repoRoot = process.cwd()

interface PackageJson {
  main: string
  version: string
  scripts: Record<string, string>
  devDependencies: Record<string, string>
  build: {
    appId: string
    productName: string
    artifactName: string
    directories: { output: string }
    files: string[]
    win: { target: string[] }
    nsis: {
      oneClick: boolean
      perMachine: boolean
      allowToChangeInstallationDirectory: boolean
      deleteAppDataOnUninstall: boolean
      createDesktopShortcut: boolean
      createStartMenuShortcut: boolean
      shortcutName: string
    }
  }
}

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as PackageJson

describe('打包入口', () => {
  it('main 指向 electron-vite 的产物', () => {
    expect(pkg.main).toBe('./out/main/index.js')
  })

  it('files 收进 out 与 package.json', () => {
    expect(pkg.build.files).toContain('out/**/*')
    expect(pkg.build.files).toContain('package.json')
  })

  it('files 不收源码与测试', () => {
    for (const pattern of pkg.build.files) {
      expect(pattern).not.toMatch(/^src\//)
      expect(pattern).not.toMatch(/^tests\//)
      expect(pattern).not.toMatch(/^e2e\//)
    }
  })

  it('产物目录是 release，且已被 gitignore', () => {
    expect(pkg.build.directories.output).toBe('release')

    const ignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8')
    expect(ignore).toMatch(/^release\/$/m)
  })
})

describe('打包目标', () => {
  it('只打 Windows 的 dir、zip 与 nsis', () => {
    expect(pkg.build.win.target).toEqual(['dir', 'zip', 'nsis'])
  })

  it('不用 electron-builder 自带的 portable target', () => {
    // 它把应用解压到临时目录再跑，process.execPath 指向临时目录，
    // 与 src/main/storage/portable.ts 的判据直接冲突
    expect(pkg.build.win.target).not.toContain('portable')
  })

  it('产物文件名是 ASCII，不含中文', () => {
    expect(pkg.build.artifactName).toMatch(/^[\x20-\x7e]+$/)
  })

  it('appId 是 ASCII 反向域名', () => {
    expect(pkg.build.appId).toMatch(/^[a-z0-9.-]+$/)
  })
})

describe('NSIS 安装器', () => {
  it('走向导而不是一键安装', () => {
    // 一键安装会把应用直接塞进默认目录，用户连装到哪都看不到
    expect(pkg.build.nsis.oneClick).toBe(false)
  })

  it('装到用户目录，免管理员权限', () => {
    // perMachine: true 会要求 UAC 提权并装进 Program Files
    expect(pkg.build.nsis.perMachine).toBe(false)
  })

  it('允许用户改安装目录', () => {
    expect(pkg.build.nsis.allowToChangeInstallationDirectory).toBe(true)
  })

  it('卸载时保留用户数据', () => {
    // 书库与批注是用户资产，卸载应用不该顺手删掉
    expect(pkg.build.nsis.deleteAppDataOnUninstall).toBe(false)
  })

  it('创建桌面与开始菜单快捷方式', () => {
    expect(pkg.build.nsis.createDesktopShortcut).toBe(true)
    expect(pkg.build.nsis.createStartMenuShortcut).toBe(true)
    expect(pkg.build.nsis.shortcutName).toBe('电纸书阅读器')
  })
})

describe('打包脚本', () => {
  it('三个打包脚本都先 build', () => {
    expect(pkg.scripts['package:dir']).toContain('npm run build')
    expect(pkg.scripts['package:zip']).toContain('npm run build')
    expect(pkg.scripts['package:installer']).toContain('npm run build')
  })

  it('安装器脚本打的是 nsis target', () => {
    expect(pkg.scripts['package:installer']).toContain('nsis')
  })

  it('打包脚本不进 verify', () => {
    // verify 是每次交付都要跑的门禁，塞进一个分钟级且要联网下载二进制的步骤
    // 只会让人开始跳过 verify
    expect(pkg.scripts['verify']).not.toContain('package')
  })

  it('electron-builder 是 devDependency', () => {
    expect(pkg.devDependencies['electron-builder']).toBeDefined()
  })
})
