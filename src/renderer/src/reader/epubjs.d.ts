declare module 'epubjs' {
  interface EpubRendition {
    display(target?: string): Promise<unknown>
    next(): Promise<unknown>
    prev(): Promise<unknown>
    destroy(): void
  }

  interface EpubBook {
    ready: Promise<unknown>
    renderTo(element: HTMLElement, options?: { width?: string; height?: string; flow?: string }): EpubRendition
    destroy(): void
  }

  export default function ePub(data: ArrayBuffer): EpubBook
}
