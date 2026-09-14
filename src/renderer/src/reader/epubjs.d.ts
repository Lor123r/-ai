declare module 'epubjs' {
  // epub.js 不带官方类型，这里只声明默认导出；具体形状由 createEpubBook.ts 统一描述，
  // 免得同一份接口在两处各写一遍之后慢慢走样。
  import type { EpubBook } from './createEpubBook'

  export default function ePub(data: ArrayBuffer): EpubBook
}
