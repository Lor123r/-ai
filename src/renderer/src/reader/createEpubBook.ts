import ePub from 'epubjs'

export interface EpubRendition {
  display(target?: string): Promise<unknown>
  next(): Promise<unknown>
  prev(): Promise<unknown>
  destroy(): void
}

export interface EpubBook {
  ready: Promise<unknown>
  renderTo(element: HTMLElement, options?: { width?: string; height?: string; flow?: string }): EpubRendition
  destroy(): void
}

export function createEpubBook(bytes: Uint8Array): EpubBook {
  // 复制一份，既保证拿到独立的 ArrayBuffer（跨进程传来的可能是视图或 SharedArrayBuffer），
  // 也让 epub.js 内部对其做引用计数时不会影响调用方持有的数据。
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return ePub(copy.buffer)
}
