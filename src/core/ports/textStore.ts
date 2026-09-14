/**
 * 一小块文本的读写端口。
 * 用它把「怎么存」和「存什么」分开：书库的序列化逻辑可以完全脱离文件系统测试。
 */
export interface TextStore {
  /** 不存在时返回 null（而不是抛错），让调用方按空状态处理。 */
  read(): Promise<string | null>
  write(content: string): Promise<void>
}
