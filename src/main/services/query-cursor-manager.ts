/**
 * 查询游标管理器 (P1-4)
 * 管理大结果集的分块取数状态，支持后端分页。
 */
import type { QueryEditableMetadata } from '../../shared/connections'

/** 单次查询返回行数上限 */
export const QUERY_ROW_LIMIT = 5_000

export interface QueryCursor {
  id: string
  engine: 'SQLite' | 'MySQL' | 'PostgreSQL' | 'DuckDB' | 'SQL Server' | 'MongoDB' | 'ClickHouse' | 'Redis' | '达梦' | '人大金仓'
  /** SQLite: 文件路径; MySQL/PostgreSQL: 连接标识 */
  connectionKey: string
  databaseName: string
  sql: string
  columns: string[]
  editable?: QueryEditableMetadata
  offset: number
  totalRows: number
  createdAt: number
}

/** 游标过期时间：30 分钟 */
const CURSOR_TTL_MS = 30 * 60 * 1000

const cursors = new Map<string, QueryCursor>()
let cursorSeq = 0

/** 定期清理过期游标 */
setInterval(() => {
  const now = Date.now()
  for (const [id, cursor] of cursors) {
    if (now - cursor.createdAt > CURSOR_TTL_MS) cursors.delete(id)
  }
}, 60_000).unref()

export const createCursor = (params: Omit<QueryCursor, 'id' | 'createdAt'>): QueryCursor => {
  const id = `cursor-${++cursorSeq}-${Date.now()}`
  const cursor: QueryCursor = { ...params, id, createdAt: Date.now() }
  cursors.set(id, cursor)
  return cursor
}

export const getCursor = (id: string): QueryCursor | undefined => {
  const cursor = cursors.get(id)
  if (cursor && Date.now() - cursor.createdAt > CURSOR_TTL_MS) {
    cursors.delete(id)
    return undefined
  }
  return cursor
}

export const updateCursorOffset = (id: string, offset: number): void => {
  const cursor = cursors.get(id)
  if (cursor) cursor.offset = offset
}

export const deleteCursor = (id: string): void => {
  cursors.delete(id)
}

/** 判断 SQL 是否为 SELECT 查询（可添加 LIMIT） */
export const isSelectQuery = (sql: string): boolean => {
  const trimmed = sql.trim().replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')
  return /^\s*SELECT\b/i.test(trimmed)
}

/** 为 SQL 添加 LIMIT 子句（如尚未包含） */
export const applyLimit = (sql: string, limit: number): string => {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (/\bLIMIT\b/i.test(trimmed)) return trimmed
  return `${trimmed} LIMIT ${limit}`
}

/** 为 SQL 添加 LIMIT + OFFSET 子句 */
export const applyLimitOffset = (sql: string, limit: number, offset: number): string => {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (/\bLIMIT\b/i.test(trimmed)) {
    // 已有 LIMIT，替换为新的 LIMIT + OFFSET
    return trimmed.replace(/\bLIMIT\s+\d+/i, `LIMIT ${limit}`).replace(/\bOFFSET\s+\d+/i, '').trim() + ` OFFSET ${offset}`
  }
  return `${trimmed} LIMIT ${limit} OFFSET ${offset}`
}
