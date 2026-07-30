/**
 * 查询游标管理器 (P1-4)
 * 管理大结果集的分块取数状态，支持后端分页。
 */
import type { QueryEditableMetadata } from '../../shared/connections'

/** 单次查询返回行数上限 */
export const QUERY_ROW_LIMIT = 5_000

export interface QueryCursor {
  id: string
  connectionId?: number
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

export const deleteCursorsForConnection = (connectionId: number): void => {
  for (const [id, cursor] of cursors) {
    if (cursor.connectionId === connectionId) cursors.delete(id)
  }
}

/**
 * 返回最外层真正执行的 SQL 动词。
 * 识别 WITH / WITH RECURSIVE CTE，并忽略 CTE 括号内部的 SELECT。
 */
export const getTopLevelStatement = (sql: string): { keyword: string; index: number } => {
  let index = 0
  let depth = 0
  let quote = ''
  let dollarTag = ''
  let lineComment = false
  let blockComment = false
  let sawWith = false
  while (index < sql.length) {
    const current = sql[index]
    const next = sql[index + 1]
    if (lineComment) { if (current === '\n') lineComment = false; index += 1; continue }
    if (blockComment) { if (current === '*' && next === '/') { blockComment = false; index += 2 } else index += 1; continue }
    if (dollarTag) { if (sql.startsWith(dollarTag, index)) { index += dollarTag.length; dollarTag = '' } else index += 1; continue }
    if (quote) {
      if (current === '\\') { index += 2; continue }
      if (current === quote) {
        if (sql[index + 1] === quote && quote !== '`') index += 2
        else { quote = ''; index += 1 }
      } else index += 1
      continue
    }
    if (current === '-' && next === '-') { lineComment = true; index += 2; continue }
    if (current === '#') { lineComment = true; index += 1; continue }
    if (current === '/' && next === '*') { blockComment = true; index += 2; continue }
    if (current === "'" || current === '"' || current === '`') { quote = current; index += 1; continue }
    if (current === '$') {
      const match = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)
      if (match) { dollarTag = match[0]; index += dollarTag.length; continue }
    }
    if (current === '(') { depth += 1; index += 1; continue }
    if (current === ')') { depth = Math.max(0, depth - 1); index += 1; continue }
    if (depth === 0 && /[A-Za-z]/.test(current)) {
      const wordIndex = index
      const match = sql.slice(index).match(/^[A-Za-z]+/)
      const keyword = match?.[0].toUpperCase() ?? ''
      index += match?.[0].length ?? 1
      if (!sawWith) {
        if (keyword === 'WITH') { sawWith = true; continue }
        return { keyword, index: wordIndex }
      }
      if (keyword === 'SELECT' || keyword === 'INSERT' || keyword === 'UPDATE' || keyword === 'DELETE' || keyword === 'MERGE') return { keyword, index: wordIndex }
      continue
    }
    index += 1
  }
  return { keyword: '', index: -1 }
}

/** 判断 SQL 是否为 SELECT 查询（可安全添加 LIMIT） */
export const isSelectQuery = (sql: string): boolean => {
  return getTopLevelStatement(sql).keyword === 'SELECT'
}

/** 为 SQL 添加 LIMIT 子句（如尚未包含） */
export const applyLimit = (sql: string, limit: number): string => {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  const statement = getTopLevelStatement(trimmed)
  const scopeStart = Math.max(0, statement.index)
  const scope = trimmed.slice(scopeStart)
  const numericLimit = scope.match(/\bLIMIT\s+(\d+)(\s*,\s*(\d+))?/i)
  if (numericLimit) {
    const requested = Number(numericLimit[3] ?? numericLimit[1])
    if (requested <= limit) return trimmed
    const replacement = numericLimit[3]
      ? `LIMIT ${numericLimit[1]}, ${limit}`
      : `LIMIT ${limit}`
    const matchStart = scopeStart + (numericLimit.index ?? 0)
    return `${trimmed.slice(0, matchStart)}${replacement}${trimmed.slice(matchStart + numericLimit[0].length)}`
  }
  const limitAll = scope.match(/\bLIMIT\s+ALL\b/i)
  if (limitAll) {
    const matchStart = scopeStart + (limitAll.index ?? 0)
    return `${trimmed.slice(0, matchStart)}LIMIT ${limit}${trimmed.slice(matchStart + limitAll[0].length)}`
  }
  if (/\bLIMIT\b/i.test(scope)) return trimmed
  return `${trimmed} LIMIT ${limit}`
}

/** 为 SQL 添加 LIMIT + OFFSET 子句 */
export const applyLimitOffset = (sql: string, limit: number, offset: number): string => {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  const statement = getTopLevelStatement(trimmed)
  const scopeStart = Math.max(0, statement.index)
  const prefix = trimmed.slice(0, scopeStart)
  const scope = trimmed.slice(scopeStart)
  if (/\bLIMIT\s+\d+\s*,\s*\d+/i.test(scope)) {
    return prefix + scope.replace(/\bLIMIT\s+\d+\s*,\s*\d+/i, `LIMIT ${limit} OFFSET ${offset}`)
  }
  if (/\bLIMIT\b/i.test(scope)) {
    // 已有 LIMIT，替换为新的 LIMIT + OFFSET
    return prefix + scope
      .replace(/\bLIMIT\s+(?:\d+|ALL)/i, `LIMIT ${limit}`)
      .replace(/\bOFFSET\s+\d+/i, '')
      .trim() + ` OFFSET ${offset}`
  }
  return `${trimmed} LIMIT ${limit} OFFSET ${offset}`
}
