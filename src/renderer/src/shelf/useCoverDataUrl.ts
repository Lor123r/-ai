import { useEffect, useState } from 'react'
import type { CoverReader } from '@core/ports/bookCover'
import { toCoverDataUrl } from './coverImage'

/**
 * 读取封面并转成可直接放进 <img src> 的地址。
 * 读不到（没封面、文件丢了、没有 preload 桥）一律返回 null 交给调用方显示占位。
 */
export function useCoverDataUrl(reader: CoverReader | null, bookId: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!reader) {
      setDataUrl(null)
      return
    }

    let active = true
    void reader
      .read(bookId)
      .then((cover) => {
        if (active && cover) setDataUrl(toCoverDataUrl(cover))
      })
      .catch(() => {
        // 封面只是装饰，读失败不该影响书架本身
      })

    return () => {
      active = false
    }
  }, [reader, bookId])

  return dataUrl
}
