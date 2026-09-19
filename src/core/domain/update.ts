/**
 * 版本比较与「有没有新版本」的判定。
 *
 * 刻意放在 core 而不是主进程：这段逻辑是纯函数，没有任何 IO，而它恰恰是最容易写错的
 * 地方（`1.10.0` 与 `1.9.0` 谁大、`v` 前缀要不要剥、预发布版怎么排）。放在 core 里
 * 就能被单测直接覆盖，不必启动 Electron。
 */

/** 语义化版本的三段数字。预发布与构建元数据不参与比较，见 parseVersion 的注释。 */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

/**
 * 解析版本号，失败返回 null。
 *
 * 只认 `major.minor.patch` 三段，允许前导 `v`。**刻意不支持预发布后缀**（`1.0.0-beta.1`）：
 * 我们的发布流程只产出正式版，而把预发布语义做对（`1.0.0-beta` < `1.0.0`）需要一整套
 * 比较规则，收益为零。带后缀的版本会被当成「解析失败」而不是「比正式版小」—— 后者会
 * 让一个 beta 包被静默当成旧版本，用户永远收不到提示。
 */
export function parseVersion(raw: string): ParsedVersion | null {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim().replace(/^v/i, '')
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed)
  if (!match) return null

  const [, major, minor, patch] = match
  return { major: Number(major), minor: Number(minor), patch: Number(patch) }
}

/**
 * 比较两个版本号。a 比 b 新返回正数，旧返回负数，相同返回 0。
 *
 * 任一侧解析失败时返回 0（当作「一样」）。这是刻意的保守选择：解析失败意味着我们
 * 读不懂对方的版本号，此时**不该**提示用户升级 —— 一个读不懂的版本号很可能来自
 * 格式变更，提示升级会把用户引到一个我们没验证过的状态。
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0

  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

/** 检查更新的结果。`available` 为真时 `latestVersion` 一定有值。 */
export type UpdateCheckResult =
  | { status: 'available'; latestVersion: string; currentVersion: string }
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'unavailable'; reason: UpdateUnavailableReason }

/**
 * 拿不到更新信息的原因。
 *
 * 分这么细是因为**它们对用户的意义完全不同**：`not-packaged` 与 `no-feed` 是「这个
 * 构建本来就不该检查更新」，界面上一个字都不该显示；`network` 与 `malformed` 是
 * 「检查失败了」，但前者重试有用、后者重试没用。合成一个 `failed` 会让界面只能
 * 说一句含糊的「检查更新失败」。
 */
export type UpdateUnavailableReason =
  | 'not-packaged'
  | 'no-feed'
  | 'network'
  | 'malformed'

/**
 * 判定有没有新版本。
 *
 * `currentVersion` 解析失败时返回 `unavailable` 而不是 `up-to-date`：应用自己的版本号
 * 读不出来说明构建有问题，此时说「已是最新」是在撒谎。
 */
export function evaluateUpdate(
  currentVersion: string,
  latestVersion: string
): UpdateCheckResult {
  if (!parseVersion(currentVersion)) {
    return { status: 'unavailable', reason: 'malformed' }
  }

  if (!parseVersion(latestVersion)) {
    return { status: 'unavailable', reason: 'malformed' }
  }

  if (compareVersions(latestVersion, currentVersion) > 0) {
    return { status: 'available', latestVersion, currentVersion }
  }

  return { status: 'up-to-date', currentVersion }
}

/**
 * 界面上的提示文案。`null` 表示不该显示任何东西。
 *
 * 只有 `available` 会产出文案：`up-to-date` 是用户主动点「检查更新」才该看到的反馈，
 * 而我们的检查是启动时自动跑的，自动弹一句「已是最新」纯属打扰。`unavailable` 同理 ——
 * 网络不通不该在书架上留一条红字。
 */
export function describeUpdate(result: UpdateCheckResult): string | null {
  if (result.status !== 'available') return null
  return `有新版本 v${result.latestVersion}（当前 v${result.currentVersion}）`
}
