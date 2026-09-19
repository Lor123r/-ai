import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  describeUpdate,
  evaluateUpdate,
  parseVersion
} from '@core/domain/update'

describe('parseVersion', () => {
  it('解析三段版本号', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('剥掉前导 v', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion('V1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('容忍首尾空白', () => {
    expect(parseVersion('  1.2.3  ')).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('段数不对时返回 null', () => {
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('1.2.3.4')).toBeNull()
    expect(parseVersion('1')).toBeNull()
  })

  it('预发布后缀一律判为解析失败', () => {
    // 刻意不支持：把 1.0.0-beta 当成「比 1.0.0 小」会让一个 beta 包被静默当成旧版本，
    // 用户永远收不到提示。判成解析失败至少是「读不懂」，而不是「读错了」。
    expect(parseVersion('1.0.0-beta.1')).toBeNull()
    expect(parseVersion('1.0.0+build.5')).toBeNull()
  })

  it('非数字段返回 null', () => {
    expect(parseVersion('a.b.c')).toBeNull()
    expect(parseVersion('1.x.3')).toBeNull()
  })

  it('空串返回 null', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('   ')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('按 major / minor / patch 依次比较', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.3', '1.2.2')).toBeGreaterThan(0)
  })

  it('相同版本返回 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('⭐ 按数字而不是字典序比较', () => {
    // 这条是这段逻辑最容易写错的地方：字符串比较下 '1.10.0' < '1.9.0'，
    // 于是 1.10.0 发布后所有 1.9.0 用户都收不到更新提示。
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
  })

  it('任一侧解析失败时返回 0', () => {
    // 读不懂就当作「一样」，不提示升级：一个读不懂的版本号很可能来自格式变更，
    // 提示升级会把用户引到一个我们没验证过的状态。
    expect(compareVersions('1.2.3', 'garbage')).toBe(0)
    expect(compareVersions('garbage', '1.2.3')).toBe(0)
  })
})

describe('evaluateUpdate', () => {
  it('远端更新时给出 available', () => {
    expect(evaluateUpdate('0.1.0', '0.2.0')).toEqual({
      status: 'available',
      latestVersion: '0.2.0',
      currentVersion: '0.1.0'
    })
  })

  it('版本相同时给出 up-to-date', () => {
    expect(evaluateUpdate('0.1.0', '0.1.0')).toEqual({
      status: 'up-to-date',
      currentVersion: '0.1.0'
    })
  })

  it('本地更新时给出 up-to-date', () => {
    // 用户装了比发布源更新的版本（比如自己构建的），不该提示他「降级」
    expect(evaluateUpdate('0.3.0', '0.2.0')).toEqual({
      status: 'up-to-date',
      currentVersion: '0.3.0'
    })
  })

  it('当前版本解析失败时给出 malformed 而不是 up-to-date', () => {
    // 应用自己的版本号读不出来说明构建有问题，此时说「已是最新」是在撒谎
    expect(evaluateUpdate('garbage', '0.2.0')).toEqual({
      status: 'unavailable',
      reason: 'malformed'
    })
  })

  it('远端版本解析失败时给出 malformed', () => {
    expect(evaluateUpdate('0.1.0', 'garbage')).toEqual({
      status: 'unavailable',
      reason: 'malformed'
    })
  })
})

describe('describeUpdate', () => {
  it('有新版本时给出带两个版本号的文案', () => {
    expect(describeUpdate({ status: 'available', latestVersion: '0.2.0', currentVersion: '0.1.0' })).toBe(
      '有新版本 v0.2.0（当前 v0.1.0）'
    )
  })

  it('已是最新时不产出文案', () => {
    // 检查是启动时自动跑的，自动弹一句「已是最新」纯属打扰
    expect(describeUpdate({ status: 'up-to-date', currentVersion: '0.1.0' })).toBeNull()
  })

  it('拿不到更新信息时不产出文案', () => {
    // 网络不通不该在书架上留一条红字
    expect(describeUpdate({ status: 'unavailable', reason: 'network' })).toBeNull()
    expect(describeUpdate({ status: 'unavailable', reason: 'no-feed' })).toBeNull()
    expect(describeUpdate({ status: 'unavailable', reason: 'not-packaged' })).toBeNull()
    expect(describeUpdate({ status: 'unavailable', reason: 'malformed' })).toBeNull()
  })
})
