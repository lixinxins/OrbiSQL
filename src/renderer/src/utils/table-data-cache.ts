/**
 * 表数据读取的统一请求层（优化方案 P1-3）
 *
 * 表数据浏览、导出预览、数据对比等场景统一走这里：
 * - 相同 (连接, 数据库, 表, 分页, 筛选) 的并发读取只发一次 IPC；
 * - 短 TTL 缓存避免切换标签/组件反复请求同一页数据；
 * - 行编辑/删除后调用 invalidateTableDataCache 使缓存失效。
 */
import type { QueryExecutionResult, TableDataFilter } from '@/shared/connections'
import { cachedRequest, invalidateCachePrefix } from './request-cache'

export const TABLE_DATA_CACHE_TTL_MS = 15_000

export const tableDataCacheKey = (
  connectionId: number,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): string =>
  `table-data:${connectionId}|${databaseName}|${tableName}|${limit}|${offset}|${JSON.stringify(filter ?? null)}`

export async function readTableDataCached(
  connectionId: number,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter,
  options?: { force?: boolean }
): Promise<QueryExecutionResult> {
  return cachedRequest(
    tableDataCacheKey(connectionId, databaseName, tableName, limit, offset, filter),
    () => window.omnidb.tables.readData(connectionId, databaseName, tableName, limit, offset, filter),
    { ttlMs: TABLE_DATA_CACHE_TTL_MS, force: options?.force }
  )
}

/** 行编辑/删除等写操作后调用，使该表的全部分页缓存失效 */
export function invalidateTableDataCache(connectionId: number, databaseName: string, tableName: string): void {
  invalidateCachePrefix(`table-data:${connectionId}|${databaseName}|${tableName}|`)
}
