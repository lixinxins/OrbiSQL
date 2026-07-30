/**
 * 达梦（DM）独立 adapter
 * 达梦兼容 PostgreSQL 协议，复用 pg 驱动连接和查询执行，
 * 但元数据查询使用达梦自有系统视图（ALL_TABLES / ALL_TAB_COLUMNS / ALL_INDEXES 等）
 */
import { Pool } from 'pg'
import { buildSslConfig } from '../ssl-helper'
import {
  isSelectQuery,
  applyLimit,
  applyLimitOffset,
  QUERY_ROW_LIMIT,
  createCursor,
  updateCursorOffset,
  deleteCursor
} from '../query-cursor-manager'
import type { QueryCursor } from '../query-cursor-manager'
import type {
  ConnectionActionResult,
  DatabaseItem,
  MySQLColumnType,
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput,
  TableDataFilter,
  TableDefinitionResult,
  TableForeignKeyDefinition
} from '@/shared/connections'
import type { AdapterConnection } from './postgresql-adapter'

// ── helpers ────────────────────────────────────────────────────────────

const quoteDm = (value: string): string => `"${value.replaceAll('"', '""')}"`
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`

const normalizedColumnType = (dataType: string): MySQLColumnType => {
  const type = dataType.toUpperCase()
  if (type.includes('BIGINT')) return 'BIGINT'
  if (type.includes('SMALLINT')) return 'SMALLINT'
  if (type.includes('TINYINT')) return 'TINYINT'
  if (type === 'INT' || type === 'INTEGER') return 'INT'
  if (type.includes('NUMERIC') || type.includes('DECIMAL') || type.includes('NUMBER')) return 'DECIMAL'
  if (type.includes('DOUBLE') || type.includes('FLOAT')) return 'DOUBLE'
  if (type.includes('REAL')) return 'FLOAT'
  if (type === 'BIT' || type === 'BOOLEAN' || type === 'BOOL') return 'BOOLEAN'
  if (type.includes('CHAR') || type.includes('VARCHAR') || type.includes('TEXT') || type.includes('CLOB')) return 'VARCHAR'
  if (type.includes('DATETIME') || type.includes('TIMESTAMP')) return 'DATETIME'
  if (type === 'DATE') return 'DATE'
  if (type.includes('TIME')) return 'TIME'
  if (type.includes('BLOB') || type.includes('BINARY') || type.includes('VARBINARY')) return 'BLOB'
  if (type === 'UUID') return 'UUID'
  return 'TEXT'
}

const filterDm = (filter: TableDataFilter): string => {
  const column = quoteDm(filter.column)
  const textValue = quoteLiteral(filter.value)
  const textColumn = `CAST(${column} AS VARCHAR)`
  const conditions: Record<TableDataFilter['operator'], string> = {
    equals: `${column} = ${textValue}`,
    notEquals: `${column} <> ${textValue}`,
    contains: `${textColumn} LIKE ${quoteLiteral(`%${filter.value}%`)}`,
    startsWith: `${textColumn} LIKE ${quoteLiteral(`${filter.value}%`)}`,
    greaterThan: `${column} > ${textValue}`,
    greaterThanOrEqual: `${column} >= ${textValue}`,
    lessThan: `${column} < ${textValue}`,
    lessThanOrEqual: `${column} <= ${textValue}`,
    isEmpty: `${textColumn} = ''`,
    isEmptyOrNull: `(${column} IS NULL OR ${textColumn} = '')`,
    isNotEmpty: `(${column} IS NOT NULL AND ${textColumn} <> '')`,
    isNull: `${column} IS NULL`,
    isNotNull: `${column} IS NOT NULL`
  }
  return conditions[filter.operator]
}

// ── DM pool cache ─────────────────────────────────────────────────────

const dmPools = new Map<string, Pool>()
const dmLastAccess = new Map<string, number>()

export const getDmPool = async (connection: AdapterConnection): Promise<Pool> => {
  const identity = connection.id != null && connection.id > 0 ? `id:${connection.id}` : `${connection.host}:${connection.port}:${connection.username}`
  const key = `${identity}:${connection.defaultDatabase}`
  const existing = dmPools.get(key)
  if (existing) { dmLastAccess.set(key, Date.now()); return existing }

  const pool = new Pool({
    host: connection.host,
    port: connection.port || 5236,
    user: connection.username || 'SYSDBA',
    password: connection.password || '',
    database: connection.defaultDatabase || 'DAMENG',
    ssl: buildSslConfig(connection),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  })
  dmPools.set(key, pool)
  dmLastAccess.set(key, Date.now())
  return pool
}

export const closeDmPools = async (connection: AdapterConnection): Promise<void> => {
  const prefix = connection.id != null && connection.id > 0
    ? `id:${connection.id}:`
    : `${connection.host}:${connection.port}:${connection.username}:`
  for (const [key, pool] of dmPools) {
    if (key.startsWith(prefix)) {
      try { await pool.end() } catch { /* ignore */ }
      dmPools.delete(key)
    }
  }
}

/** 驱逐空闲超过 maxIdleMs 的连接池 */
export const evictIdleDmPools = async (maxIdleMs: number): Promise<void> => {
  const now = Date.now()
  for (const [key, pool] of dmPools) {
    if (now - (dmLastAccess.get(key) ?? 0) > maxIdleMs) {
      try { await pool.end() } catch { /* ignore */ }
      dmPools.delete(key)
      dmLastAccess.delete(key)
    }
  }
}

// ── DM functions ──────────────────────────────────────────────────────

export const readDmDatabases = async (connection: AdapterConnection, options?: { light?: boolean }): Promise<DatabaseItem[]> => {
  const pool = await getDmPool(connection)
  const dbResult = await pool.query<{ datname: string }>(`SELECT name AS datname FROM v$database`)
  const dbName = dbResult.rows[0]?.datname || 'DAMENG'

  // 使用达梦系统视图
  const tableResult = await pool.query<{ schemaName: string; tableName: string; comment: string | null }>(
    `SELECT OWNER AS "schemaName", TABLE_NAME AS "tableName", COMMENTS AS "comment"
     FROM ALL_TABLES t LEFT JOIN ALL_TAB_COMMENTS c ON t.OWNER = c.OWNER AND t.TABLE_NAME = c.TABLE_NAME
     ORDER BY t.OWNER, t.TABLE_NAME`
  )

  if (options?.light) {
    const tablesBySchema = new Map<string, DatabaseItem['tables']>()
    for (const row of tableResult.rows) {
      const tables = tablesBySchema.get(row.schemaName) ?? []
      tables.push({ name: row.tableName, comment: row.comment || '', columns: [], indexes: [], foreignKeys: [], checks: [], triggers: [] })
      tablesBySchema.set(row.schemaName, tables)
    }
    return [{
      name: dbName,
      charset: 'UTF-8',
      collation: '',
      tables: tablesBySchema.get('SYSDBA') ?? [],
      views: [],
      functions: [],
      procedures: [],
      indexes: [],
      triggers: []
    }]
  }

  const tables: DatabaseItem['tables'] = []
  for (const row of tableResult.rows) {
    try {
      const [cols, idxs, fks] = await Promise.all([
        pool.query<{ column_name: string; data_type: string; nullable: string; pk: number; comment: string | null }>(
          `SELECT COLUMN_NAME AS "column_name", DATA_TYPE AS "data_type",
           NULLABLE AS "nullable",
           CASE WHEN c.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS "pk",
           cm.COMMENTS AS "comment"
           FROM ALL_TAB_COLUMNS tc
           LEFT JOIN (
             SELECT cc.OWNER, cc.TABLE_NAME, COLUMN_NAME
             FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
             WHERE c.CONSTRAINT_TYPE = 'P' AND cc.OWNER = $1 AND cc.TABLE_NAME = $2
           ) c ON tc.OWNER = c.OWNER AND tc.TABLE_NAME = c.TABLE_NAME AND tc.COLUMN_NAME = c.COLUMN_NAME
           LEFT JOIN ALL_COL_COMMENTS cm ON tc.OWNER = cm.OWNER AND tc.TABLE_NAME = cm.TABLE_NAME AND tc.COLUMN_NAME = cm.COLUMN_NAME
           WHERE tc.OWNER = $1 AND tc.TABLE_NAME = $2
           ORDER BY tc.COLUMN_ID`,
          [row.schemaName, row.tableName]
        ),
        pool.query<{ index_name: string; is_unique: string }>(
          `SELECT INDEX_NAME AS "index_name", UNIQUENESS AS "is_unique"
           FROM ALL_INDEXES WHERE OWNER = $1 AND TABLE_NAME = $2`,
          [row.schemaName, row.tableName]
        ),
        pool.query<{ fk_name: string; ref_table: string }>(
          `SELECT CONSTRAINT_NAME AS "fk_name", R_CONSTRAINT_NAME AS "ref_table"
           FROM ALL_CONSTRAINTS WHERE OWNER = $1 AND TABLE_NAME = $2 AND CONSTRAINT_TYPE = 'R'`,
          [row.schemaName, row.tableName]
        )
      ])

      tables.push({
        name: row.tableName,
        comment: row.comment || '',
        columns: cols.rows.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.nullable === 'Y',
          isPrimaryKey: c.pk === 1,
          comment: c.comment || undefined
        })),
        indexes: idxs.rows.map((i) => i.index_name),
        foreignKeys: fks.rows.map((fk) => `${fk.fk_name} → ${fk.ref_table}`),
        checks: [],
        triggers: []
      })
    } catch {
      tables.push({
        name: row.tableName, comment: row.comment || '',
        columns: [], indexes: [], foreignKeys: [], checks: [], triggers: []
      })
    }
  }

  // 视图
  const viewResult = await pool.query<{ viewName: string }>(
    `SELECT VIEW_NAME AS "viewName" FROM ALL_VIEWS WHERE OWNER = 'SYSDBA' ORDER BY VIEW_NAME`
  )
  // 存储过程
  const procResult = await pool.query<{ procName: string }>(
    `SELECT OBJECT_NAME AS "procName" FROM ALL_OBJECTS WHERE OBJECT_TYPE = 'PROCEDURE' AND OWNER = 'SYSDBA' ORDER BY OBJECT_NAME`
  )
  // 函数
  const funcResult = await pool.query<{ funcName: string }>(
    `SELECT OBJECT_NAME AS "funcName" FROM ALL_OBJECTS WHERE OBJECT_TYPE = 'FUNCTION' AND OWNER = 'SYSDBA' ORDER BY OBJECT_NAME`
  )

  return [{
    name: dbName,
    charset: 'UTF-8',
    collation: '',
    tables,
    views: viewResult.rows.map((v) => v.viewName),
    functions: funcResult.rows.map((f) => f.funcName),
    procedures: procResult.rows.map((p) => p.procName),
    indexes: [],
    triggers: []
  }]
}

export const executeDmQuery = async (connection: AdapterConnection, databaseName: string, sqlText: string): Promise<QueryExecutionResult> => {
  const pool = await getDmPool(connection)
  const startTime = new Date().toISOString()
  const startMs = performance.now()

  try {
    const isSelect = isSelectQuery(sqlText)
    const execSql = isSelect && !/\bLIMIT\b/i.test(sqlText) ? applyLimit(sqlText, QUERY_ROW_LIMIT) : sqlText
    const result = await pool.query(execSql)
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)

    if (result.fields.length > 0) {
      const rows = result.rows as Array<Record<string, unknown>>
      const columns = result.fields.map((field) => field.name)
      const truncated = isSelect && rows.length >= QUERY_ROW_LIMIT

      let editable: QueryExecutionResult['editable']
      const tableName = sqlText.match(/\bFROM\s+"?([A-Za-z0-9_$]+)"?/i)?.[1]
      if (tableName) {
        try {
          const pkResult = await pool.query(
            `SELECT cc.COLUMN_NAME AS "column_name" FROM ALL_CONSTRAINTS c
             JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME
             WHERE c.CONSTRAINT_TYPE = 'P' AND c.TABLE_NAME = $1 ORDER BY cc.POSITION`,
            [tableName]
          )
          const primaryKeys = pkResult.rows.map((r: any) => r.column_name)
          if (primaryKeys.length && primaryKeys.every((key: string) => columns.includes(key))) {
            const validColumns = new Set(columns)
            editable = {
              tableName,
              primaryKeys,
              columns: columns.filter((c) => validColumns.has(c)).map((c) => ({
                resultName: c, sourceName: c, primaryKey: primaryKeys.includes(c)
              }))
            }
          }
        } catch { /* ignore */ }
      }

      let cursorId: string | undefined
      if (truncated) {
        const cursor = createCursor({
          connectionId: connection.id,
          engine: '达梦',
          connectionKey: `${connection.host}:${connection.port}/${databaseName}`,
          databaseName,
          sql: sqlText,
          columns,
          editable,
          offset: rows.length,
          totalRows: rows.length
        })
        cursorId = cursor.id
      }

      const msg = truncated ? `查询成功，显示前 ${rows.length} 行` : `查询成功，共 ${rows.length} 行`
      return {
        success: true, message: msg, columns, rows, editable,
        startTime, endTime, durationMs, queryCount: 1, successCount: 1, errorCount: 0,
        truncated, cursorId
      }
    }

    const affected = result.rowCount ?? 0
    return {
      success: true, message: `执行成功，影响 ${affected} 行`, affectedRows: affected,
      startTime, endTime, durationMs, queryCount: 1, successCount: 1, errorCount: 0
    }
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return { success: false, message: error instanceof Error ? error.message : '查询执行失败', startTime, endTime, durationMs, queryCount: 1, successCount: 0, errorCount: 1 }
  }
}

export const fetchMoreDmRows = async (
  connection: AdapterConnection,
  _databaseName: string,
  cursor: QueryCursor,
  count: number = QUERY_ROW_LIMIT
): Promise<{ rows: Array<Record<string, unknown>>; done: boolean }> => {
  const pool = await getDmPool(connection)
  const limitedSql = applyLimitOffset(cursor.sql, count, cursor.offset)
  const result = await pool.query(limitedSql)
  const rows = (result.rows ?? []) as Array<Record<string, unknown>>
  const done = rows.length < count
  updateCursorOffset(cursor.id, cursor.offset + rows.length)
  if (done) deleteCursor(cursor.id)
  return { rows, done }
}

export const readDmTableData = async (
  connection: AdapterConnection,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  const where = filter?.column ? ` WHERE ${filterDm(filter)}` : ''
  const sqlText = `SELECT * FROM ${quoteDm(tableName)}${where} LIMIT ${limit} OFFSET ${offset}`
  const result = await executeDmQuery(connection, databaseName, sqlText)
  return result.success && result.rows ? { ...result, message: `已加载 ${result.rows.length} 行数据` } : result
}

export const updateDmRow = async (connection: AdapterConnection, _databaseName: string, input: QueryUpdateRowInput): Promise<ConnectionActionResult> => {
  const pool = await getDmPool(connection)
  const changes = Object.keys(input.changes)
  const setClauses = changes.map((col) => `${quoteDm(col)} = ${quoteLiteral(String(input.changes[col]))}`)
  const whereClauses = Object.keys(input.primaryKeyValues).map((col) => `${quoteDm(col)} = ${quoteLiteral(String(input.primaryKeyValues[col]))}`)
  const result = await pool.query(`UPDATE ${quoteDm(input.tableName)} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`)
  const affected = result.rowCount ?? 0
  return { success: true, message: affected ? '数据已保存' : '数据没有变化' }
}

export const deleteDmRow = async (connection: AdapterConnection, _databaseName: string, input: QueryDeleteRowInput): Promise<ConnectionActionResult> => {
  const pool = await getDmPool(connection)
  const whereClauses = Object.keys(input.primaryKeyValues).map((col) => `${quoteDm(col)} = ${quoteLiteral(String(input.primaryKeyValues[col]))}`)
  const result = await pool.query(`DELETE FROM ${quoteDm(input.tableName)} WHERE ${whereClauses.join(' AND ')}`)
  const affected = result.rowCount ?? 0
  return affected ? { success: true, message: '数据已删除' } : { success: false, message: '未找到该数据，可能已被修改或删除' }
}

export const getDmTableDefinition = async (connection: AdapterConnection, _databaseName: string, tableName: string): Promise<TableDefinitionResult> => {
  const pool = await getDmPool(connection)

  try {
    const colResult = await pool.query<{ column_name: string; data_type: string; nullable: string; pk: number; default_value: string | null; comment: string | null }>(
      `SELECT tc.COLUMN_NAME AS "column_name", tc.DATA_TYPE AS "data_type",
       tc.NULLABLE AS "nullable",
       CASE WHEN cc.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS "pk",
       tc.DATA_DEFAULT AS "default_value",
       cmc.COMMENTS AS "comment"
       FROM ALL_TAB_COLUMNS tc
       LEFT JOIN (
         SELECT acc.OWNER, acc.TABLE_NAME, COLUMN_NAME
         FROM ALL_CONSTRAINTS ac JOIN ALL_CONS_COLUMNS acc ON ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME
         WHERE ac.CONSTRAINT_TYPE = 'P' AND acc.TABLE_NAME = $1
       ) cc ON tc.OWNER = cc.OWNER AND tc.TABLE_NAME = cc.TABLE_NAME AND tc.COLUMN_NAME = cc.COLUMN_NAME
       LEFT JOIN ALL_COL_COMMENTS cmc ON tc.OWNER = cmc.OWNER AND tc.TABLE_NAME = cmc.TABLE_NAME AND tc.COLUMN_NAME = cmc.COLUMN_NAME
       WHERE tc.TABLE_NAME = $1
       ORDER BY tc.COLUMN_ID`,
      [tableName]
    )

    if (!colResult.rows.length) return { success: false, message: '数据表不存在或没有字段' }

    const idxResult = await pool.query<{ index_name: string; is_unique: string; column_name: string }>(
      `SELECT i.INDEX_NAME AS "index_name", i.UNIQUENESS AS "is_unique", ic.COLUMN_NAME AS "column_name"
       FROM ALL_INDEXES i JOIN ALL_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME
       WHERE i.TABLE_NAME = $1 ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION`,
      [tableName]
    )
    const indexMap = new Map<string, { name: string; type: 'UNIQUE' | 'INDEX'; columns: string[] }>()
    for (const row of idxResult.rows) {
      const idx = indexMap.get(row.index_name) ?? { name: row.index_name, type: row.is_unique === 'UNIQUE' ? 'UNIQUE' as const : 'INDEX' as const, columns: [] }
      idx.columns.push(row.column_name)
      indexMap.set(row.index_name, idx)
    }

    const fkResult = await pool.query<{ fk_name: string; column_name: string; ref_table: string; ref_column: string; on_delete: string; on_update: string }>(
      `SELECT ac.CONSTRAINT_NAME AS "fk_name", acc.COLUMN_NAME AS "column_name",
       arc.TABLE_NAME AS "ref_table", arc.COLUMN_NAME AS "ref_column",
       ac.DELETE_RULE AS "on_delete", 'NO ACTION' AS "on_update"
       FROM ALL_CONSTRAINTS ac
       JOIN ALL_CONS_COLUMNS acc ON ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME
       JOIN ALL_CONS_COLUMNS arc ON ac.R_CONSTRAINT_NAME = arc.CONSTRAINT_NAME
       WHERE ac.CONSTRAINT_TYPE = 'R' AND ac.TABLE_NAME = $1`,
      [tableName]
    )

    return {
      success: true,
      message: '表结构读取成功',
      tableName,
      tableComment: '',
      columns: colResult.rows.map((c) => ({
        name: c.column_name,
        originalName: c.column_name,
        type: normalizedColumnType(c.data_type),
        typeDefinition: c.data_type,
        length: '',
        decimals: '',
        notNull: c.nullable === 'N',
        primaryKey: c.pk === 1,
        comment: c.comment || '',
        defaultValue: c.default_value
      })),
      indexes: Array.from(indexMap.values()),
      foreignKeys: fkResult.rows.map((fk) => ({
        name: fk.fk_name,
        column: fk.column_name,
        referencedTable: fk.ref_table,
        referencedColumn: fk.ref_column,
        onDelete: (fk.on_delete === 'CASCADE' ? 'CASCADE' : fk.on_delete === 'SET NULL' ? 'SET NULL' : 'NO ACTION') as TableForeignKeyDefinition['onDelete'],
        onUpdate: (fk.on_update === 'CASCADE' ? 'CASCADE' : fk.on_update === 'SET NULL' ? 'SET NULL' : 'NO ACTION') as TableForeignKeyDefinition['onUpdate']
      }))
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '读取表结构失败' }
  }
}
