import { useEffect, useState } from 'react'
import type { RuntimeVersions } from '@shared/ipc'
import { getRuntimeVersions } from '@renderer/platform/runtime'

/**
 * 读运行时版本信息。
 *
 * 版本信息走一次异步 IPC（应用版本只有主进程知道），所以这里必须用 effect 而不是
 * 直接调用 —— 在渲染期发起 Promise 会让每次重渲染都多一次 IPC，而且拿不到结果时
 * 组件已经提交了。
 *
 * 拿不到就保持 undefined，由 `formatRuntimeLabel` 回落成「浏览器预览模式」。
 * 这里刻意不区分「还在加载」与「没有桥」：两者在界面上都只该显示同一句兜底文案，
 * 多一个 loading 态只会让那行小字闪一下。
 */
export function useRuntimeVersions(): RuntimeVersions | undefined {
  const [versions, setVersions] = useState<RuntimeVersions | undefined>(undefined)

  useEffect(() => {
    let active = true
    const pending = getRuntimeVersions()
    if (!pending) return undefined

    void pending
      .then((resolved) => {
        if (active) setVersions(resolved)
      })
      .catch(() => {
        // 版本信息拿不到不影响任何功能，静默回落成兜底文案
      })

    return () => {
      active = false
    }
  }, [])

  return versions
}
