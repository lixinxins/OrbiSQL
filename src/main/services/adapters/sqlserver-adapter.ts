import sql from 'mssql'
import {
  isSelectQuery,
  getTopLevelStatement,
  QUERY_ROW_LIMIT,
  createCursor,
  updateCursorOffset,
  deleteCursor
} from '../query-cursor-manager'
import type { QueryCursor } from '../query-cursor-manager'
import type {
  ConnectionActionResult,
  DatabaseItem,
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput,
  TableDataFilter,
  TableDefinitionResult,
  TableForeignKeyDefinition,
  MySQLColumnType
} from '@/shared/connections'
import type { AdapterConnection } from './postgresql-adapter'

// ── helpers ────────────────────────────────────────────────────────────

const quoteMssql = (value: string): string => `[${value.replaceAll(']', ']]')}]`
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`

const normalizedColumnType = (dataType: string): MySQLColumnType => {
  const type = dataType.toLowerCase()
  if (type.includes('bigint')) return 'BIGINT'
  if (type.includes('smallint')) return 'SMALLINT'
  if (type.includes('tinyint')) return 'TINYINT'
  if (type === 'int' || type === 'integer') return 'INT'
  if (type.includes('decimal') || type.includes('numeric') || type === 'money' || type === 'smallmoney') return 'DECIMAL'
  if (type.includes('float')) return 'DOUBLE'
  if (type.includes('real')) return 'FLOAT'
  if (type.includes('bit')) return 'BOOLEAN'
  if (type.includes('nvarchar') || type.includes('nchar') || type.includes('ntext')) return 'VARCHAR'
  if (type.includes('varchar') || type.includes('char')) return 'VARCHAR'
  if (type.includes('text')) return 'TEXT'
  if (type.includes('datetime2') || type.includes('datetime') || type === 'smalldatetime') return 'DATETIME'
  if (type === 'date') return 'DATE'
  if (type.includes('time')) return 'TIME'
  if (type.includes('binary') || type.includes('varbinary') || type === 'image') return 'BLOB'
  if (type === 'uniqueidentifier') return 'UUID'
  if (type === 'xml') return 'JSON'
  return 'TEXT'
}

const filterMssql = (filter: TableDataFilter): string => {
  const column = quoteMssql(filter.column)
  const textValue = quoteLiteral(filter.value)
  const textColumn = `CAST(${column} AS NVARCHAR(MAX))`
  const conditions: Record<TableDataFilter['operator'], string> = {
    equals: `${column} = ${textValue}`,
    notEquals: `${column} <> ${textValue}`,
    contains: `${textColumn} LIKE ${quoteLiteral(`%${filter.value}%`)}`,
    startsWith: `${textColumn} LIKE ${quoteLiteral(`${filter.value}%`)}`,
    greaterThan: `${column} > ${textValue}`,
    greaterThanOrEqual: `${column} >= ${textValue}`,
    lessThan: `${column} < ${textValue}`,
    lessThanOrEqual: `${column} <= ${textValue}`,
    isEmpty: `${textColumn} = N''`,
    isEmptyOrNull: `(${column} IS NULL OR ${textColumn} = N'')`,
    isNotEmpty: `(${column} IS NOT NULL AND ${textColumn} <> N'')`,
    isNull: `${column} IS NULL`,
    isNotNull: `${column} IS NOT NULL`
  }
  return conditions[filter.operator]
}

/** 将 SELECT 改写为 TOP N 形式（SQL Server 不支持 LIMIT 语法） */
const applyTop = (sqlText: string, limit: number): string => {
  const trimmed = sqlText.trim().replace(/;\s*$/, '')
  if (/\bOFFSET\s+\d+\s+ROWS?/i.test(trimmed)) return trimmed
  const statement = getTopLevelStatement(trimmed)
  const topMatch = statement.keyword === 'SELECT'
    ? trimmed.slice(statement.index).match(/^SELECT\s+(?:(?:ALL|DISTINCT)\s+)?TOP\s*\(?\s*(\d+)\s*\)?/i)
    : null
  if (topMatch) {
    const requested = Number(topMatch[1])
    if (requested <= limit) return trimmed
    const matchedTop = topMatch[0].match(/\bTOP\s*\(?\s*\d+\s*\)?/i)
    if (!matchedTop || matchedTop.index == null) return trimmed
    const topStart = statement.index + matchedTop.index
    return `${trimmed.slice(0, topStart)}TOP ${limit}${trimmed.slice(topStart + matchedTop[0].length)}`
  }
  if (statement.keyword !== 'SELECT') return trimmed
  const selectEnd = statement.index + 'SELECT'.length
  const modifier = trimmed.slice(selectEnd).match(/^\s+(?:ALL|DISTINCT)\b/i)?.[0] ?? ''
  const insertAt = selectEnd + modifier.length
  return `${trimmed.slice(0, insertAt)} TOP ${limit}${trimmed.slice(insertAt)}`
}

const applyTopOffset = (sqlText: string, limit: number, offset: number): string => {
  const trimmed = sqlText.trim().replace(/;\s*$/, '')
  const withoutPagination = trimmed.replace(/\s+OFFSET\s+\d+\s+ROWS?(?:\s+FETCH\s+NEXT\s+\d+\s+ROWS?\s+ONLY)?\s*$/i, '')
  const statement = getTopLevelStatement(withoutPagination)
  const hasTop = statement.keyword === 'SELECT' && /^SELECT\s+(?:(?:ALL|DISTINCT)\s+)?TOP\s*\(?\s*\d+/i.test(withoutPagination.slice(statement.index))
  if (hasTop) {
    return `SELECT * FROM (${withoutPagination}) AS [__quilldb_page] ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
  }
  const orderBy = /\bORDER\s+BY\b/i.test(withoutPagination.slice(Math.max(0, statement.index))) ? '' : ' ORDER BY (SELECT NULL)'
  return `${withoutPagination}${orderBy} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
}

// ── SQL Server pool cache ─────────────────────────────────────────────

const mssqlPools = new Map<string, sql.ConnectionPool>()
const mssqlLastAccess = new Map<string, number>()

const getMssqlPool = async (connection: AdapterConnection, databaseName?: string): Promise<sql.ConnectionPool> => {
  const database = databaseName || connection.defaultDatabase || 'master'
  const identity = connection.id != null && connection.id > 0
    ? `id:${connection.id}`
    : `${connection.host}:${connection.port}:${connection.username}`
  const key = `${identity}:${database}`
  const existing = mssqlPools.get(key)
  if (existing?.connected) { mssqlLastAccess.set(key, Date.now()); return existing }
  const config: sql.config = {
    server: connection.host,
    port: connection.port || 1433,
    user: connection.username,
    password: connection.password,
    database,
    options: {
      encrypt: connection.sslEnabled,
      trustServerCertificate: !connection.sslRejectUnauthorized,
      enableArithAbort: true
    },
    connectionTimeout: 5000,
    requestTimeout: 30000,
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 }
  }
  const pool = new sql.ConnectionPool(config)
  await pool.connect()
  mssqlPools.set(key, pool)
  mssqlLastAccess.set(key, Date.now())
  return pool
}

export const closeMssqlPools = async (connection: AdapterConnection): Promise<void> => {
  const prefix = connection.id != null && connection.id > 0
    ? `id:${connection.id}:`
    : `${connection.host}:${connection.port}:${connection.username}:`
  for (const [key, pool] of mssqlPools) {
    if (key.startsWith(prefix)) {
      try { await pool.close() } catch { /* ignore */ }
      mssqlPools.delete(key)
    }
  }
}

/** 驱逐空闲超过 maxIdleMs 的连接池 */
export const evictIdleMssqlPools = async (maxIdleMs: number): Promise<void> => {
  const now = Date.now()
  for (const [key, pool] of mssqlPools) {
    if (now - (mssqlLastAccess.get(key) ?? 0) > maxIdleMs) {
      try { await pool.close() } catch { /* ignore */ }
      mssqlPools.delete(key)
      mssqlLastAccess.delete(key)
    }
  }
}

// ── SQL Server functions ──────────────────────────────────────────────

export const readMssqlDatabases = async (connection: AdapterConnection, options?: { light?: boolean }): Promise<DatabaseItem[]> => {
  const pool = await getMssqlPool(connection)
  const dbResult = await pool.request().query<{ name: string; collation_name: string }>(
    `SELECT name, collation_name FROM sys.databases WHERE database_id > 4 ORDER BY name`
  )

  if (options?.light) {
    return Promise.all(dbResult.recordset.map(async (db: { name: string; collation_name?: string }) => {
      const databasePool = await getMssqlPool(connection, db.name)
      const tableResult = await databasePool.request().query<{ tableName: string }>(
        `SELECT name AS tableName FROM sys.tables ORDER BY name`
      )
      return {
        name: db.name,
        charset: 'utf16',
        collation: db.collation_name || '',
        tables: tableResult.recordset.map((row) => ({ name: row.tableName, comment: '', columns: [], indexes: [], foreignKeys: [], checks: [], triggers: [] })),
        views: [], functions: [], procedures: [], indexes: [], triggers: []
      }
    }))
  }

  const databases: DatabaseItem[] = []
  for (const db of dbResult.recordset) {
    try {
      const databasePool = await getMssqlPool(connection, db.name)
      const [tables, views, procs, funcs] = await Promise.all([
        databasePool.request().query<{ tableName: string }>(`SELECT name AS tableName FROM sys.tables ORDER BY name`),
        databasePool.request().query<{ viewName: string }>(`SELECT name AS viewName FROM sys.views WHERE is_ms_shipped = 0 ORDER BY name`),
        databasePool.request().query<{ procName: string }>(`SELECT name AS procName FROM sys.procedures WHERE is_ms_shipped = 0 ORDER BY name`),
        databasePool.request().query<{ funcName: string }>(`SELECT name AS funcName FROM sys.objects WHERE type IN ('FN','IF','TF') AND is_ms_shipped = 0 ORDER BY name`)
      ])
      const tableItems: DatabaseItem['tables'] = []
      for (const t of tables.recordset) {
        const [cols, idxs, fks] = await Promise.all([
          databasePool.request().input('table', t.tableName).query<{ column_name: string; data_type: string; is_nullable: string; is_primary_key: boolean }>(
            `SELECT c.name AS column_name, tp.name AS data_type,
              CASE WHEN c.is_nullable = 1 THEN 'YES' ELSE 'NO' END AS is_nullable,
              CAST(ISNULL(pk.is_primary_key, 0) AS BIT) AS is_primary_key
             FROM sys.columns c
             JOIN sys.types tp ON c.user_type_id = tp.user_type_id
             LEFT JOIN (
               SELECT ic.column_id, 1 AS is_primary_key
               FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
               WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(@table)
             ) pk ON c.column_id = pk.column_id
             WHERE c.object_id = OBJECT_ID(@table)
             ORDER BY c.column_id`
          ),
          databasePool.request().input('table', t.tableName).query<{ index_name: string }>(
            `SELECT DISTINCT i.name AS index_name FROM sys.indexes i
             WHERE i.object_id = OBJECT_ID(@table) AND i.is_primary_key = 0 AND i.type IS NOT NULL ORDER BY i.name`
          ),
          databasePool.request().input('table', t.tableName).query<{ fk_name: string; ref_table: string }>(
            `SELECT fk.name AS fk_name, OBJECT_NAME(fk.referenced_object_id) AS ref_table
             FROM sys.foreign_keys fk WHERE fk.parent_object_id = OBJECT_ID(@table)`
          )
        ])
        tableItems.push({
          name: t.tableName,
          comment: '',
          columns: cols.recordset.map((c: { column_name: string; data_type: string; is_nullable: string; is_primary_key: boolean }) => ({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable === 'YES',
            isPrimaryKey: c.is_primary_key,
            comment: undefined
          })),
          indexes: idxs.recordset.map((i: { index_name: string }) => i.index_name),
          foreignKeys: fks.recordset.map((fk: { fk_name: string; ref_table: string }) => `${fk.fk_name} → ${fk.ref_table}`),
          checks: [],
          triggers: []
        })
      }
      databases.push({
        name: db.name,
        charset: 'utf16',
        collation: db.collation_name || '',
        tables: tableItems,
        views: views.recordset.map((v: { viewName: string }) => v.viewName),
        functions: funcs.recordset.map((f: { funcName: string }) => f.funcName),
        procedures: procs.recordset.map((p: { procName: string }) => p.procName),
        indexes: [],
        triggers: []
      })
    } catch {
      databases.push({
        name: db.name, charset: 'utf16', collation: db.collation_name || '',
        tables: [], views: [], functions: [], procedures: [], indexes: [], triggers: []
      })
    }
  }
  return databases
}

export const executeMssqlQuery = async (connection: AdapterConnection, databaseName: string, sqlText: string): Promise<QueryExecutionResult> => {
  const pool = await getMssqlPool(connection, databaseName)
  const startTime = new Date().toISOString()
  const startMs = performance.now()
  try {
    const isSelect = isSelectQuery(sqlText)
    const execSql = isSelect ? applyTop(sqlText, QUERY_ROW_LIMIT) : sqlText
    const result = await pool.request().query(execSql)
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)

    if (result.recordset) {
      const rows = result.recordset as Array<Record<string, unknown>>
      const columns = rows.length
        ? Object.keys(rows[0])
        : Object.keys((result.recordset as unknown as { columns?: Record<string, unknown> }).columns ?? {})
      const truncated = isSelect && rows.length >= QUERY_ROW_LIMIT

      let editable: QueryExecutionResult['editable']
      const tableName = sqlText.match(/\bFROM\s+\[?([A-Za-z0-9_$]+)\]?/i)?.[1]
      if (tableName) {
        try {
          const pkResult = await pool.request().input('table', tableName).query<{ column_name: string }>(
            `SELECT c.name AS column_name FROM sys.indexes i
             JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
             JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
             WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(@table)
             ORDER BY ic.key_ordinal`
          )
          const primaryKeys = pkResult.recordset.map((r: { column_name: string }) => r.column_name)
          if (primaryKeys.length && primaryKeys.every((key: string) => columns.includes(key))) {
            const validColumns = new Set(columns)
            editable = {
              tableName,
              primaryKeys,
              columns: columns.filter((c: string) => validColumns.has(c)).map((c: string) => ({
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
          engine: 'SQL Server',
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

    const affected = result.rowsAffected?.[0] ?? 0
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

export const fetchMoreMssqlRows = async (
  connection: AdapterConnection,
  databaseName: string,
  cursor: QueryCursor,
  count: number = QUERY_ROW_LIMIT
): Promise<{ rows: Array<Record<string, unknown>>; done: boolean }> => {
  const pool = await getMssqlPool(connection, databaseName)
  const limitedSql = applyTopOffset(cursor.sql, count, cursor.offset)
  const result = await pool.request().query(limitedSql)
  const rows = (result.recordset ?? []) as Array<Record<string, unknown>>
  const done = rows.length < count
  updateCursorOffset(cursor.id, cursor.offset + rows.length)
  if (done) deleteCursor(cursor.id)
  return { rows, done }
}

export const readMssqlTableData = async (
  connection: AdapterConnection,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  if (filter?.column) {
    const pool = await getMssqlPool(connection, databaseName)
    const colCheck = await pool.request()
      .input('table', tableName).input('col', filter.column)
      .query<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM sys.columns WHERE object_id = OBJECT_ID(@table) AND name = @col`)
    if (!colCheck.recordset[0]?.cnt) return { success: false, message: '筛选字段不存在' }
  }
  const where = filter?.column ? ` WHERE ${filterMssql(filter)}` : ''
  const sqlText = `SELECT * FROM ${quoteMssql(tableName)}${where}`
  const withOffset = offset > 0 ? applyTopOffset(sqlText, limit, offset) : applyTop(sqlText, limit)
  const result = await executeMssqlQuery(connection, databaseName, withOffset)
  return result.success && result.rows ? { ...result, message: `已加载 ${result.rows.length} 行数据` } : result
}

export const updateMssqlRow = async (connection: AdapterConnection, databaseName: string, input: QueryUpdateRowInput): Promise<ConnectionActionResult> => {
  const pool = await getMssqlPool(connection, databaseName)
  const pkResult = await pool.request().input('table', input.tableName).query<{ column_name: string }>(
    `SELECT c.name AS column_name FROM sys.indexes i
     JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
     JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
     WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(@table)
     ORDER BY ic.key_ordinal`
  )
  const primaryKeys = pkResult.recordset.map((r: { column_name: string }) => r.column_name)
  if (!primaryKeys.length || primaryKeys.some((key: string) => !(key in input.primaryKeyValues))) {
    return { success: false, message: '查询结果缺少完整主键，无法安全保存' }
  }
  const changes = Object.keys(input.changes)
  const request = pool.request()
  const setClauses = changes.map((col: string) => {
    request.input(`set_${col}`, input.changes[col])
    return `${quoteMssql(col)} = @set_${col}`
  })
  const whereClauses = primaryKeys.map((col: string) => {
    request.input(`pk_${col}`, input.primaryKeyValues[col])
    return `${quoteMssql(col)} = @pk_${col}`
  })
  const result = await request.query(`UPDATE ${quoteMssql(input.tableName)} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`)
  const affected = result.rowsAffected?.[0] ?? 0
  return { success: true, message: affected ? '数据已保存' : '数据没有变化' }
}

export const deleteMssqlRow = async (connection: AdapterConnection, databaseName: string, input: QueryDeleteRowInput): Promise<ConnectionActionResult> => {
  const pool = await getMssqlPool(connection, databaseName)
  const pkResult = await pool.request().input('table', input.tableName).query<{ column_name: string }>(
    `SELECT c.name AS column_name FROM sys.indexes i
     JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
     JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
     WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(@table)
     ORDER BY ic.key_ordinal`
  )
  const primaryKeys = pkResult.recordset.map((r: { column_name: string }) => r.column_name)
  if (!primaryKeys.length || primaryKeys.some((key: string) => !(key in input.primaryKeyValues))) {
    return { success: false, message: '缺少完整主键，无法安全删除数据' }
  }
  const request = pool.request()
  const whereClauses = primaryKeys.map((col: string) => {
    request.input(`pk_${col}`, input.primaryKeyValues[col])
    return `${quoteMssql(col)} = @pk_${col}`
  })
  const result = await request.query(`DELETE FROM ${quoteMssql(input.tableName)} WHERE ${whereClauses.join(' AND ')}`)
  const affected = result.rowsAffected?.[0] ?? 0
  return affected ? { success: true, message: '数据已删除' } : { success: false, message: '未找到该数据，可能已被修改或删除' }
}

export const getMssqlTableDefinition = async (connection: AdapterConnection, databaseName: string, tableName: string): Promise<TableDefinitionResult> => {
  const pool = await getMssqlPool(connection, databaseName)

  const colResult = await pool.request().input('table', tableName).query<{
    column_name: string; data_type: string; max_length: number; precision: number; scale: number;
    is_nullable: string; is_primary_key: boolean; default_value: string | null
  }>(
    `SELECT c.name AS column_name, tp.name AS data_type,
      c.max_length, c.precision, c.scale,
      CASE WHEN c.is_nullable = 1 THEN 'YES' ELSE 'NO' END AS is_nullable,
      CAST(ISNULL(pk.is_primary_key, 0) AS BIT) AS is_primary_key,
      OBJECT_DEFINITION(c.default_object_id) AS default_value
     FROM sys.columns c
     JOIN sys.types tp ON c.user_type_id = tp.user_type_id
     LEFT JOIN (
       SELECT ic.column_id, 1 AS is_primary_key
       FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
       WHERE i.is_primary_key = 1 AND i.object_id = OBJECT_ID(@table)
     ) pk ON c.column_id = pk.column_id
     WHERE c.object_id = OBJECT_ID(@table)
     ORDER BY c.column_id`
  )
  if (!colResult.recordset.length) return { success: false, message: '数据表不存在或没有字段' }

  const idxResult = await pool.request().input('table', tableName).query<{ index_name: string; is_unique: boolean; column_name: string }>(
    `SELECT i.name AS index_name, i.is_unique, c.name AS column_name
     FROM sys.indexes i
     JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
     JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
     WHERE i.object_id = OBJECT_ID(@table) AND i.is_primary_key = 0 AND i.type IS NOT NULL
     ORDER BY i.name, ic.key_ordinal`
  )
  const indexMap = new Map<string, { name: string; type: 'UNIQUE' | 'INDEX'; columns: string[] }>()
  for (const row of idxResult.recordset) {
    const idx = indexMap.get(row.index_name) ?? { name: row.index_name, type: row.is_unique ? 'UNIQUE' as const : 'INDEX' as const, columns: [] }
    idx.columns.push(row.column_name)
    indexMap.set(row.index_name, idx)
  }

  const fkResult = await pool.request().input('table', tableName).query<{
    fk_name: string; column_name: string; ref_table: string; ref_column: string; on_delete: string; on_update: string
  }>(
    `SELECT fk.name AS fk_name,
      COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS column_name,
      OBJECT_NAME(fkc.referenced_object_id) AS ref_table,
      COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS ref_column,
      fk.delete_referential_action_desc AS on_delete,
      fk.update_referential_action_desc AS on_update
     FROM sys.foreign_keys fk
     JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
     WHERE fk.parent_object_id = OBJECT_ID(@table)`
  )

  return {
    success: true,
    message: '表结构读取成功',
    tableName,
    tableComment: '',
    columns: colResult.recordset.map((c: { column_name: string; data_type: string; max_length: number; precision: number; scale: number; is_nullable: string; is_primary_key: boolean; default_value: string | null }) => ({
      name: c.column_name,
      originalName: c.column_name,
      type: normalizedColumnType(c.data_type),
      typeDefinition: c.data_type + (c.max_length > 0 && ['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(c.data_type) ? `(${c.data_type === 'nvarchar' ? c.max_length / 2 : c.max_length})` : ''),
      length: c.max_length > 0 ? String(c.data_type === 'nvarchar' ? c.max_length / 2 : c.max_length) : '',
      decimals: c.scale > 0 ? String(c.scale) : '',
      notNull: c.is_nullable === 'NO',
      primaryKey: c.is_primary_key,
      comment: '',
      defaultValue: c.default_value
    })),
    indexes: Array.from(indexMap.values()),
    foreignKeys: fkResult.recordset.map((fk: { fk_name: string; column_name: string; ref_table: string; ref_column: string; on_delete: string; on_update: string }) => ({
      name: fk.fk_name,
      column: fk.column_name,
      referencedTable: fk.ref_table,
      referencedColumn: fk.ref_column,
      onDelete: (fk.on_delete === 'CASCADE' ? 'CASCADE' : fk.on_delete === 'SET_NULL' ? 'SET NULL' : fk.on_delete === 'NO_ACTION' ? 'NO ACTION' : 'RESTRICT') as TableForeignKeyDefinition['onDelete'],
      onUpdate: (fk.on_update === 'CASCADE' ? 'CASCADE' : fk.on_update === 'SET_NULL' ? 'SET NULL' : fk.on_update === 'NO_ACTION' ? 'NO ACTION' : 'RESTRICT') as TableForeignKeyDefinition['onUpdate']
    }))
  }
}

export const executeMssqlFile = async (connection: AdapterConnection, databaseName: string, sqlText: string): Promise<void> => {
  const pool = await getMssqlPool(connection, databaseName)
  await pool.request().query(sqlText)
}
