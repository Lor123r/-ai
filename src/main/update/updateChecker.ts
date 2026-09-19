import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluateUpdate, type UpdateCheckResult, type UpdateUnavailableReason } from '@core/domain/update'

/**
 * 更新源地址。指向 electron-builder 生成的 `latest.yml`。
 *
 * 地址**不写在代码里**，而是打包时由 `package.json` 的 `build.publish` 写进
 * `resources/app-update.yml`，运行时读出来。这样「发布到哪」是打包配置的一部分，
 * 改地址不用改代码，也不会出现「代码里写死一个地址、打包配置里写另一个」的分裂。
 *
 * 应用**不去猜**这个地址 —— 猜错的表现是静默地永远检查不到更新，比不检查更糟。
 * 读不到 `app-update.yml` 就是「这个构建不检查更新」。
 */
export const UPDATE_CONFIG_FILE = 'app-update.yml'

/** 检查更新的超时。启动路径上的网络请求必须有上限，否则断网时会挂很久。 */
export const UPDATE_TIMEOUT_MS = 5000

export interface UpdateProbe {
  /** 是否已打包。开发态不检查更新。 */
  isPackaged: boolean
  /** 更新源地址；空字符串表示没配。 */
  feedUrl: string
  /** 当前应用版本。 */
  currentVersion: string
  /** 取文本，失败时抛错。 */
  fetchText: (url: string, timeoutMs: number) => Promise<string>
  /** 留痕。 */
  warn: (message: string) => void
}

/**
 * 从 `latest.yml` 里抠出版本号。
 *
 * 刻意不引 YAML 解析器：electron-builder 生成的 `latest.yml` 结构固定，其中一行就是
 * `version: 1.2.3`。为一行内容引一个依赖不划算，而多一个依赖就多一处供应链风险。
 *
 * 认不出就返回 null，由调用方判成 `malformed`。
 */
export function parseLatestVersion(yaml: string): string | null {
  if (typeof yaml !== 'string') return null

  for (const line of yaml.split(/\r?\n/)) {
    const match = /^\s*version:\s*(.+?)\s*$/.exec(line)
    if (!match) continue

    // 去掉可能存在的引号
    const value = match[1].replace(/^['"]|['"]$/g, '')
    return value.length > 0 ? value : null
  }

  return null
}

/**
 * 从 `app-update.yml` 里抠出更新源地址。
 *
 * 与 `parseLatestVersion` 同一个理由不引 YAML 解析器：electron-builder 生成的这份
 * 文件结构固定，我们只要 `url:` 那一行。认不出就返回空字符串，由调用方判成
 * `no-feed` —— 也就是「这个构建不检查更新」。
 */
export function parseFeedUrl(yaml: string): string {
  if (typeof yaml !== 'string') return ''

  for (const line of yaml.split(/\r?\n/)) {
    const match = /^\s*url:\s*(.+?)\s*$/.exec(line)
    if (!match) continue

    const value = match[1].replace(/^['"]|['"]$/g, '')
    return value.length > 0 ? value : ''
  }

  return ''
}

/**
 * 把更新源地址与 `latest.yml` 拼起来。
 *
 * `build.publish.url` 指的是**发布目录**，而 `latest.yml` 是目录里的一个文件。
 * 拼接时容忍地址末尾有没有斜杠，否则用户少写一个 `/` 就会拼出
 * `.../releaseslatest.yml` 这种必然 404 的地址。
 */
export function resolveFeedUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''
  return `${trimmed.replace(/\/+$/, '')}/latest.yml`
}

/**
 * 检查有没有新版本。**从不抛错**，所有失败都落进 `unavailable`。
 *
 * 不抛错是因为调用方在启动路径上：一次网络异常不该让窗口出不来，也不该在书架上
 * 留一条红字。检查更新是**锦上添花**，它的失败必须对用户完全透明。
 */
export async function checkForUpdate(probe: UpdateProbe): Promise<UpdateCheckResult> {
  if (!probe.isPackaged) {
    return { status: 'unavailable', reason: 'not-packaged' }
  }

  if (!probe.feedUrl) {
    return { status: 'unavailable', reason: 'no-feed' }
  }

  let yaml: string
  try {
    yaml = await probe.fetchText(probe.feedUrl, UPDATE_TIMEOUT_MS)
  } catch (error) {
    probe.warn(`检查更新失败：${error instanceof Error ? error.message : String(error)}`)
    return { status: 'unavailable', reason: 'network' }
  }

  const latestVersion = parseLatestVersion(yaml)
  if (!latestVersion) {
    probe.warn('更新源返回的内容里没有版本号')
    return { status: 'unavailable', reason: 'malformed' }
  }

  return evaluateUpdate(probe.currentVersion, latestVersion)
}

/** 供主进程直接调用的薄封装：读打包时写下的 `app-update.yml`、用全局 fetch。 */
export function defaultUpdateProbe(
  isPackaged: boolean,
  currentVersion: string,
  resourcesPath: string
): UpdateProbe {
  return {
    isPackaged,
    feedUrl: readFeedUrl(resourcesPath),
    currentVersion,
    fetchText: async (url, timeoutMs) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    },
    warn: (message) => console.warn('[update]', message)
  }
}

/**
 * 读 `resources/app-update.yml` 并解析出更新源地址。
 *
 * 读不到就返回空字符串 —— 开发态、以及没配 `build.publish` 的构建都会走到这里，
 * 两者都该是「不检查更新」而不是报错。
 */
function readFeedUrl(resourcesPath: string): string {
  try {
    const configPath = join(resourcesPath, UPDATE_CONFIG_FILE)
    return resolveFeedUrl(parseFeedUrl(readFileSync(configPath, 'utf8')))
  } catch {
    return ''
  }
}

export type { UpdateCheckResult, UpdateUnavailableReason }
