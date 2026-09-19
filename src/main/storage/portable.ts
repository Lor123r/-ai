import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 便携模式的标记文件名。放在 exe 同级目录下即启用。 */
export const PORTABLE_MARKER = 'portable.txt'

/** 便携模式的数据目录名。不直接用 exe 同级目录，见 resolvePortableDataDir 的注释。 */
export const PORTABLE_DATA_DIR = 'data'

export interface PortableProbe {
  /** 是否已打包。开发态下 process.execPath 指向 node_modules 里的 electron.exe。 */
  isPackaged: boolean
  /** 可执行文件路径，打包后是应用自己的 exe。 */
  execPath: string
  /** 判断路径是否存在且是文件。 */
  isFile: (path: string) => boolean
  /** 建目录，失败时抛错。 */
  makeDir: (path: string) => void
  /** 留痕。 */
  warn: (message: string) => void
}

function defaultProbe(isPackaged: boolean): PortableProbe {
  return {
    isPackaged,
    execPath: process.execPath,
    isFile: (path) => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    },
    makeDir: (path) => {
      mkdirSync(path, { recursive: true })
    },
    warn: (message) => console.warn('[portable]', message)
  }
}

/**
 * 判断这次启动该不该用便携数据目录，返回绝对路径或 null。
 *
 * **判据是「exe 同级有 portable.txt」，不是「exe 同级可写」。** 可写性探测要真的写一个
 * 文件再删掉：在只读介质上会失败，在 Program Files 下会失败，在 U 盘上会成功 —— 但用户
 * 把应用装在 U 盘上并不等于他想让数据跟着 U 盘走。一个显式的标记文件是**用户意图**，
 * 可写性是**环境事实**，两者不等价，而这里要的是前者。
 *
 * 数据落在 `<exe 目录>/data` 而不是 exe 同级：后者会把 library.json、annotations.json、
 * books/、covers/ 和 exe、resources/、locales/ 混在一起，用户想「把数据拷走」时无从下手。
 * 拷走 data/ 就等于拷走全部用户数据。
 *
 * 建目录失败时返回 null 而不是抛错：启动链上没有人接得住异常（见 startup.ts），一次
 * mkdir 失败就意味着窗口永远不出现。但**必须留痕** —— 用户以为数据在 U 盘上、实际写进了
 * %APPDATA%，拔了 U 盘换台机器就会以为「书全没了」。
 */
export function resolvePortableDataDir(probe: PortableProbe): string | null {
  if (!probe.isPackaged) return null

  const execDir = dirname(probe.execPath)
  if (!execDir || execDir === '.') {
    probe.warn('拿不到可执行文件所在目录，便携模式未启用')
    return null
  }

  // 用 isFile 而不是 existsSync：portable.txt 是个目录时 existsSync 也返回 true，
  // 那会把一个同名目录误判成「用户想开便携模式」。
  if (!probe.isFile(join(execDir, PORTABLE_MARKER))) return null

  const dataDir = join(execDir, PORTABLE_DATA_DIR)
  try {
    probe.makeDir(dataDir)
  } catch (error) {
    probe.warn(
      `便携数据目录建不出来（${error instanceof Error ? error.message : String(error)}），` +
        `本次改用默认数据目录；数据不会写进 ${dataDir}`
    )
    return null
  }

  return dataDir
}

export interface UserDataOverride {
  /** 最终生效的数据目录；null 表示沿用 Electron 默认值。 */
  dir: string | null
  /** 这次覆盖的来源，便于启动时留痕。 */
  source: 'env' | 'portable' | 'default'
}

/**
 * 决定本次启动的数据目录。**必须在 app.whenReady() 之前调用**，否则 setPath 不生效。
 *
 * 优先级：环境变量 > 便携模式 > Electron 默认。
 *
 * 环境变量排在最前，因为它是**测试基础设施**：E2E 必须能无视仓库里有没有 portable.txt
 * 而钉死数据目录。反过来会让 E2E 依赖工作区状态 —— 谁在仓库根目录放一个 portable.txt，
 * 全部用例就开始往那儿写。
 */
export function resolveUserDataOverride(
  env: string | undefined,
  probe: PortableProbe
): UserDataOverride {
  if (env) return { dir: env, source: 'env' }

  const portable = resolvePortableDataDir(probe)
  if (portable) return { dir: portable, source: 'portable' }

  return { dir: null, source: 'default' }
}

/**
 * 供主进程直接调用的薄封装：算出来就 setPath，算不出来就什么都不做。
 *
 * `isPackaged` 由调用方传入而不是在这里读 `app.isPackaged`：这个模块刻意不 import
 * electron，好让整条判断逻辑能在单测里跑。**这个参数曾经被漏掉过** —— 探针里写死
 * `isPackaged: false`，于是单测全绿、真机永远走默认目录。所以它现在是必填参数，
 * 漏传会直接编译报错。
 */
export function applyUserDataOverride(
  env: string | undefined,
  isPackaged: boolean,
  setPath: (dir: string) => void,
  probe: PortableProbe = defaultProbe(isPackaged)
): UserDataOverride {
  const resolved = resolveUserDataOverride(env, probe)
  if (resolved.dir) setPath(resolved.dir)
  return resolved
}

/** 供测试与调试：标记文件是否存在于给定目录。 */
export function hasPortableMarker(execDir: string): boolean {
  return existsSync(join(execDir, PORTABLE_MARKER))
}
