/**
 * 渲染进程查询运行时工具
 * 封装 window.omnidb IPC 桥接的查询 / 事务 / 游标操作，
 * 为 useTableStore / useQueryStore 等 store 提供统一的查询执行层。
 */
import type {
  QueryExecutionResult,
  QueryStatementResult,
  TableDataFilter
} from '@/shared/connections'

// ── 常量 ────────────────────────────────────────────────────────────────

/** 单次查询返回行数上限（与主进程 QUERY_ROW_LIMIT 对齐） */
export const QUERY_ROW_LIMIT = 5_000

// ── 查询执行 ─────────────────────────────────────────────────────────────

/**
 * 执行 SQL 查询（通过 IPC 桥接到主进程）
 */
export const executeQuery = async (
  connectionId: number,
  databaseName: string,
  sql: string,
  sessionId?: string
): Promise<QueryExecutionResult> => {
  return window.omnidb.queries.execute(connectionId, databaseName, sql, sessionId)
}

/**
 * 通过服务端游标获取更多结果行
 */
export const fetchMoreRows = async (
  connectionId: number,
  databaseName: string,
  cursorId: string
): Promise<QueryExecutionResult> => {
  return window.omnidb.queries.fetchMore(connectionId, databaseName, cursorId)
}

/**
 * 读取表数据（分页 + 筛选）
 */
export const readTableData = async (
  connectionId: number,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  return window.omnidb.tables.readData(connectionId, databaseName, tableName, limit, offset, filter)
}

// ── 事务管理 ─────────────────────────────────────────────────────────────

/**
 * 开启事务
 */
export const beginTransaction = async (
  connectionId: number,
  databaseName: string,
  sessionId: string
): Promise<{ success: boolean; message: string }> => {
  return window.omnidb.queries.beginTransaction(connectionId, databaseName, sessionId)
}

/**
 * 提交事务
 */
export const commitTransaction = async (
  sessionId: string
): Promise<{ success: boolean; message: string }> => {
  return window.omnidb.queries.commitTransaction(sessionId)
}

/**
 * 回滚事务
 */
export const rollbackTransaction = async (
  sessionId: string
): Promise<{ success: boolean; message: string }> => {
  return window.omnidb.queries.rollbackTransaction(sessionId)
}

// ── 行级操作 ─────────────────────────────────────────────────────────────

/**
 * 更新查询结果中的一行数据
 */
export const updateResultRow = async (input: {
  connectionId: number
  databaseName: string
  tableName: string
  primaryKeyValues: Record<string, unknown>
  changes: Record<string, unknown>
}): Promise<{ success: boolean; message: string }> => {
  return window.omnidb.queries.updateRow(input)
}

/**
 * 删除表数据中的一行
 */
export const deleteResultRow = async (input: {
  connectionId: number
  databaseName: string
  tableName: string
  primaryKeyValues: Record<string, unknown>
}): Promise<{ success: boolean; message: string }> => {
  return window.omnidb.tables.deleteRow(input)
}

// ── SQL 工具函数 ──────────────────────────────────────────────────────────

/**
 * 判断 SQL 是否为 SELECT 查询
 */
export const isSelectQuery = (sql: string): boolean => {
  const trimmed = sql.trim().replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')
  return /^\s*SELECT\b/i.test(trimmed)
}

/**
 * 为 SQL 添加 LIMIT 子句（如尚未包含）
 */
export const applyLimit = (sql: string, limit: number): string => {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (/\bLIMIT\b/i.test(trimmed)) return trimmed
  return `${trimmed} LIMIT ${limit}`
}

/**
 * 为 SQL 添加 LIMIT + OFFSET 子句
 */
export const applyLimitOffset = (sql: string, limit: number, offset: number): string => {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (/\bLIMIT\b/i.test(trimmed)) {
    return trimmed.replace(/\bLIMIT\s+\d+/i, `LIMIT ${limit}`).replace(/\bOFFSET\s+\d+/i, '').trim() + ` OFFSET ${offset}`
  }
  return `${trimmed} LIMIT ${limit} OFFSET ${offset}`
}

/**
 * 根据引擎生成带转义的 SQL 标识符引用
 */
export const sqlIdentifier = (value: string, engine: string): string => {
  if (['MySQL', 'MariaDB', 'TiDB'].includes(engine)) {
    return `\`${value.replaceAll('`', '``')}\``
  }
  return `"${value.replaceAll('"', '""')}"`
}

// ── 结果合并工具 ──────────────────────────────────────────────────────────

/**
 * 将 fetchMore 返回的增量行合并到已有结果集中
 */
export const mergeFetchedRows = (
  existing: QueryExecutionResult,
  fetched: QueryExecutionResult
): QueryExecutionResult => {
  if (!fetched.success || !fetched.rows) return existing
  return {
    ...existing,
    rows: [...(existing.rows ?? []), ...fetched.rows],
    truncated: fetched.truncated,
    cursorId: fetched.cursorId
  }
}

/**
 * 从多语句执行结果中提取当前活动的结果集
 */
export const getActiveStatementResult = (
  result: QueryExecutionResult
): QueryStatementResult | null => {
  if (!result.statementResults?.length) return null
  return result.statementResults[result.statementResults.length - 1] ?? null
}

// ── 查询状态类型 ──────────────────────────────────────────────────────────

export interface QueryRuntimeState {
  loading: boolean
  result: QueryExecutionResult | null
  error: string | null
}

export const createInitialQueryState = (): QueryRuntimeState => ({
  loading: false,
  result: null,
  error: null
})
