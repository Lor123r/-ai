import { evaluateUpdate, type UpdateCheckResult, type UpdateUnavailableReason } from '@core/domain/update'

/**
 * 更新源地址。指向 electron-builder 生成的 `latest.yml`。
 *
 * 用环境变量覆盖是为了让测试与本地验证能指向一个假源，而不必改代码或联网。
 * 打包时 electron-builder 会生成 `latest.yml`，但**应用自己不去猜这个地址** ——
 * 猜错的表现是静默地永远检查不到更新，比不检查更糟。
 */
export const UPDATE_FEED_ENV = 'EBOOK_READER_UPDATE_FEED'

/** 默认更新源。留空表示这个构建不检查更新。 */
export const DEFAULT_UPDATE_FEED = ''

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

/** 供主进程直接调用的薄封装：读环境变量、用全局 fetch。 */
export function defaultUpdateProbe(isPackaged: boolean, currentVersion: string): UpdateProbe {
  return {
    isPackaged,
    feedUrl: process.env[UPDATE_FEED_ENV] ?? DEFAULT_UPDATE_FEED,
    currentVersion,
    fetchText: async (url, timeoutMs) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    },
    warn: (message) => console.warn('[update]', message)
  }
}

export type { UpdateCheckResult, UpdateUnavailableReason }
