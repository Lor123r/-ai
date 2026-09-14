import type { TextStore } from '../ports/textStore'

/** 测试用的内存文本存储，也可以模拟磁盘写失败。 */
export class InMemoryTextStore implements TextStore {
  private content: string | null
  private failure: Error | null = null
  readonly writes: string[] = []

  constructor(initial: string | null = null) {
    this.content = initial
  }

  get current(): string | null {
    return this.content
  }

  failWith(error: Error | null): void {
    this.failure = error
  }

  async read(): Promise<string | null> {
    if (this.failure) throw this.failure
    return this.content
  }

  async write(content: string): Promise<void> {
    if (this.failure) throw this.failure
    this.writes.push(content)
    this.content = content
  }
}
