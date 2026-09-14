import type { BookImportSummary } from '@core/ports/bookImporter'
import type { ImportFailure } from '@core/ports/fileStore'

/** 只显示文件名，完整路径对用户没意义也太长。 */
function fileNameOf(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).pop() || sourcePath
}

/** 把导入结果翻译成一句人话，全成功、部分失败、全军覆没都能说清楚。 */
export function describeImportResult(summary: BookImportSummary): string {
  const parts: string[] = []
  if (summary.added > 0) parts.push(`已导入 ${summary.added} 本`)
  if (summary.skipped > 0) parts.push(`跳过 ${summary.skipped} 本重复书籍`)
  if (summary.failed.length > 0) parts.push(`${summary.failed.length} 个文件未能导入`)

  return parts.length > 0 ? parts.join('，') : '没有可导入的文件'
}

export function describeImportFailures(failed: ImportFailure[]): string | null {
  if (failed.length === 0) return null
  return failed.map((item) => `${fileNameOf(item.sourcePath)}：${item.reason}`).join('；')
}
