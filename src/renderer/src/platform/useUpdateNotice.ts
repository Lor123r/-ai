import { useEffect, useState } from 'react'
import { describeUpdate, type UpdateCheckResult } from '@core/domain/update'
import { getUpdateBridge } from '@renderer/platform/update'

/**
 * 启动时问一次有没有新版本，返回该显示的提示文案（没有就返回 null）。
 *
 * 只返回文案而不是整个结果：界面唯一要做的事就是「有就显示一行字」，把
 * `UpdateCheckResult` 整个交给组件只会让组件去判断 status，而那个判断逻辑
 * 已经在 `describeUpdate` 里了。
 *
 * 拿不到桥（浏览器预览）或检查失败都保持 null —— 检查更新是锦上添花，
 * 它的失败不该在书架上留任何痕迹。
 */
export function useUpdateNotice(): string | null {
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const bridge = getUpdateBridge()
    if (!bridge) return undefined

    void bridge
      .check()
      .then((result: UpdateCheckResult) => {
        if (active) setNotice(describeUpdate(result))
      })
      .catch(() => {
        // 主进程侧已经保证不抛错，这里兜的是 IPC 本身失败（窗口正在关闭等）
      })

    return () => {
      active = false
    }
  }, [])

  return notice
}
