import type { ExportSqlProgress } from '../../../shared/connections'

/** 导出进度回传：统一进度事件形状，供 SQL Dump 导出流程使用。 */
export function reportProgress(
  onProgress: ((progress: ExportSqlProgress) => void) | undefined,
  current: number,
  total: number,
  message: string
): void {
  onProgress?.({ current, total, message })
}
