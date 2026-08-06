/**
 * 人大金仓（KingbaseES）独立 adapter
 * 人大金仓基于 PostgreSQL 内核，复用 pg 驱动连接和查询执行，
 * 但元数据查询使用人大金仓自有系统视图（部分兼容 pg_catalog，部分有自有扩展）
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
  TableDataFilterCondition,
  TableDataFilterOperator,
  TableDefinitionResult,
  TableForeignKeyDefinition
} from '@/shared/connections'
import type { AdapterConnection } from './postgresql-adapter'

// ── helpers ────────────────────────────────────────────────────────────

const quoteKb = (value: string): string => `"${value.replaceAll('"', '""')}"`
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`

const normalizedColumnType = (dataType: string): MySQLColumnType => {
  const type = dataType.toLowerCase()
  if (type.includes('bigint')) return 'BIGINT'
  if (type.includes('smallint')) return 'SMALLINT'
  if (type === 'int' || type === 'integer') return 'INT'
  if (type.includes('numeric') || type.includes('decimal')) return 'DECIMAL'
  if (type.includes('double') || type.includes('float8')) return 'DOUBLE'
  if (type.includes('real') || type.includes('float4')) return 'FLOAT'
  if (type === 'boolean' || type === 'bool') return 'BOOLEAN'
  if (type.includes('varchar') || type.includes('character varying')) return 'VARCHAR'
  if (type.includes('char') || type.includes('bpchar')) return 'CHAR'
  if (type.includes('text')) return 'TEXT'
  if (type.includes('timestamp')) return 'DATETIME'
  if (type === 'date') return 'DATE'
  if (type.includes('time')) return 'TIME'
  if (type.includes('bytea')) return 'BYTEA'
  if (type === 'uuid') return 'UUID'
  if (type.includes('jsonb')) return 'JSONB'
  if (type.includes('json')) return 'JSON'
  return 'TEXT'
}

const filterKb = (filter: TableDataFilter): string => {
  const build = (cond: TableDataFilterCondition): string => {
    const column = quoteKb(cond.column)
    const textValue = quoteLiteral(cond.value)
    const textColumn = `CAST(${column} AS TEXT)`
    const conditions: Record<TableDataFilterOperator, string> = {
      equals: `${column} = ${textValue}`,
      notEquals: `${column} <> ${textValue}`,
      contains: `${textColumn} LIKE ${quoteLiteral(`%${cond.value}%`)}`,
      startsWith: `${textColumn} LIKE ${quoteLiteral(`${cond.value}%`)}`,
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
    return conditions[cond.operator]
  }
  return filter.filters.map(build).join(filter.logic === 'OR' ? ' OR ' : ' AND ')
}

// ── KingbaseES pool cache ─────────────────────────────────────────────

const kbPools = new Map<string, Pool>()
const kbLastAccess = new Map<string, number>()

export const getKbPool = async (connection: AdapterConnection): Promise<Pool> => {
  const identity = connection.id != null && connection.id > 0 ? `id:${connection.id}` : `${connection.host}:${connection.port}:${connection.username}`
  const key = `${identity}:${connection.defaultDatabase}`
  const existing = kbPools.get(key)
  if (existing) { kbLastAccess.set(key, Date.now()); return existing }

  const pool = new Pool({
    host: connection.host,
    port: connection.port || 54321,
    user: connection.username || 'system',
    password: connection.password || '',
    database: connection.defaultDatabase || 'test',
    ssl: buildSslConfig(connection),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  })
  kbPools.set(key, pool)
  kbLastAccess.set(key, Date.now())
  return pool
}

export const closeKbPools = async (connection: AdapterConnection): Promise<void> => {
  const prefix = connection.id != null && connection.id > 0
    ? `id:${connection.id}:`
    : `${connection.host}:${connection.port}:${connection.username}:`
  for (const [key, pool] of kbPools) {
    if (key.startsWith(prefix)) {
      try { await pool.end() } catch { /* ignore */ }
      kbPools.delete(key)
    }
  }
}

/** 驱逐空闲超过 maxIdleMs 的连接池 */
export const evictIdleKbPools = async (maxIdleMs: number): Promise<void> => {
  const now = Date.now()
  for (const [key, pool] of kbPools) {
    if (now - (kbLastAccess.get(key) ?? 0) > maxIdleMs) {
      try { await pool.end() } catch { /* ignore */ }
      kbPools.delete(key)
      kbLastAccess.delete(key)
    }
  }
}

// ── KingbaseES functions ──────────────────────────────────────────────

export const readKbDatabases = async (connection: AdapterConnection, options?: { light?: boolean }): Promise<DatabaseItem[]> => {
  const pool = await getKbPool(connection)

  // 人大金仓兼容 pg_catalog 查询数据库
  const dbResult = await pool.query<{ datname: string; encoding: string; collation: string }>(
    `SELECT d.datname, pg_catalog.pg_encoding_to_char(d.encoding) AS encoding,
     COALESCE(c.collname, '') AS collation
     FROM pg_catalog.pg_database d
     LEFT JOIN pg_catalog.pg_collation c ON d.datcollate = c.collname
     WHERE d.datistemplate = false AND d.datname NOT IN ('template0', 'template1')
     ORDER BY d.datname`
  )

  if (options?.light) {
    const tableResult = await pool.query<{ tableName: string }>(
      `SELECT tablename AS "tableName" FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    )
    const tables: DatabaseItem['tables'] = tableResult.rows.map((r) => ({
      name: r.tableName, comment: '', columns: [], indexes: [], foreignKeys: [], checks: [], triggers: []
    }))
    return dbResult.rows.map((db) => ({
      name: db.datname, charset: db.encoding, collation: db.collation,
      tables: db.datname === (connection.defaultDatabase || 'test') ? tables : [],
      views: [], functions: [], procedures: [], indexes: [], triggers: []
    }))
  }

  const databases: DatabaseItem[] = []
  for (const db of dbResult.rows) {
    try {
      await pool.query(`SET search_path TO public`)
      const [tables, views, funcs, procs] = await Promise.all([
        pool.query<{ tableName: string; comment: string | null }>(
          `SELECT c.relname AS "tableName", COALESCE(obj_description(c.oid, 'pg_class'), '') AS "comment"
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
           WHERE c.relkind = 'r' AND n.nspname = 'public' ORDER BY c.relname`
        ),
        pool.query<{ viewName: string }>(
          `SELECT viewname AS "viewName" FROM pg_catalog.pg_views WHERE schemaname = 'public' ORDER BY viewname`
        ),
        pool.query<{ funcName: string }>(
          `SELECT proname AS "funcName" FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = 'public' AND p.prokind = 'f' ORDER BY proname`
        ),
        pool.query<{ procName: string }>(
          `SELECT proname AS "procName" FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = 'public' AND p.prokind = 'p' ORDER BY proname`
        )
      ])

      const tableItems: DatabaseItem['tables'] = []
      for (const t of tables.rows) {
        try {
          const [cols, idxs, fks] = await Promise.all([
            pool.query<{ column_name: string; data_type: string; nullable: boolean; is_pk: boolean; comment: string }>(
              `SELECT a.attname AS "column_name",
               pg_catalog.format_type(a.atttypid, a.atttypmod) AS "data_type",
               NOT a.attnotnull AS "nullable",
               COALESCE((SELECT true FROM pg_catalog.pg_index i
                WHERE i.indrelid = a.attrelid AND a.attnum = ANY(i.indkey) AND i.indisprimary), false) AS "is_pk",
               COALESCE(pg_catalog.col_description(a.attrelid, a.attnum), '') AS "comment"
               FROM pg_catalog.pg_attribute a
               WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
               ORDER BY a.attnum`,
              [`public.${t.tableName}`]
            ),
            pool.query<{ index_name: string; is_unique: boolean }>(
              `SELECT i.relname AS "index_name", ix.indisunique AS "is_unique"
               FROM pg_catalog.pg_index idx
               JOIN pg_catalog.pg_class i ON idx.indexrelid = i.oid
               WHERE idx.indrelid = $1::regclass AND NOT idx.indisprimary
               ORDER BY i.relname`,
              [`public.${t.tableName}`]
            ),
            pool.query<{ fk_name: string; ref_table: string }>(
              `SELECT c.conname AS "fk_name", cc.relname AS "ref_table"
               FROM pg_catalog.pg_constraint c
               JOIN pg_catalog.pg_class cc ON c.confrelid = cc.oid
               WHERE c.conrelid = $1::regclass AND c.contype = 'f'`,
              [`public.${t.tableName}`]
            )
          ])

          tableItems.push({
            name: t.tableName,
            comment: t.comment || '',
            columns: cols.rows.map((c) => ({
              name: c.column_name, type: c.data_type, nullable: c.nullable,
              isPrimaryKey: c.is_pk, comment: c.comment || undefined
            })),
            indexes: idxs.rows.map((i) => i.index_name),
            foreignKeys: fks.rows.map((fk) => `${fk.fk_name} → ${fk.ref_table}`),
            checks: [],
            triggers: []
          })
        } catch {
          tableItems.push({
            name: t.tableName, comment: t.comment || '',
            columns: [], indexes: [], foreignKeys: [], checks: [], triggers: []
          })
        }
      }

      databases.push({
        name: db.datname,
        charset: db.encoding,
        collation: db.collation,
        tables: tableItems,
        views: views.rows.map((v) => v.viewName),
        functions: funcs.rows.map((f) => f.funcName),
        procedures: procs.rows.map((p) => p.procName),
        indexes: [],
        triggers: []
      })
    } catch {
      databases.push({
        name: db.datname, charset: db.encoding, collation: db.collation,
        tables: [], views: [], functions: [], procedures: [], indexes: [], triggers: []
      })
    }
  }
  return databases
}

export const executeKbQuery = async (connection: AdapterConnection, databaseName: string, sqlText: string): Promise<QueryExecutionResult> => {
  const pool = await getKbPool(connection)
  const startTime = new Date().toISOString()
  const startMs = performance.now()

  try {
    const isSelect = isSelectQuery(sqlText)
    const execSql = isSelect ? applyLimit(sqlText, QUERY_ROW_LIMIT) : sqlText
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
            `SELECT a.attname AS "column_name" FROM pg_catalog.pg_index i
             JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`,
            [`public.${tableName}`]
          )
          const primaryKeys = pkResult.rows.map((r: any) => r.column_name)
          if (primaryKeys.length && primaryKeys.every((key: string) => columns.includes(key))) {
            const validColumns = new Set(columns)
            editable = {
              tableName, primaryKeys,
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
          engine: '人大金仓',
          connectionKey: `${connection.host}:${connection.port}/${databaseName}`,
          databaseName, sql: sqlText, columns, editable,
          offset: rows.length, totalRows: rows.length
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

export const fetchMoreKbRows = async (
  connection: AdapterConnection,
  _databaseName: string,
  cursor: QueryCursor,
  count: number = QUERY_ROW_LIMIT
): Promise<{ rows: Array<Record<string, unknown>>; done: boolean }> => {
  const pool = await getKbPool(connection)
  const limitedSql = applyLimitOffset(cursor.sql, count, cursor.offset)
  const result = await pool.query(limitedSql)
  const rows = (result.rows ?? []) as Array<Record<string, unknown>>
  const done = rows.length < count
  updateCursorOffset(cursor.id, cursor.offset + rows.length)
  if (done) deleteCursor(cursor.id)
  return { rows, done }
}

export const readKbTableData = async (
  connection: AdapterConnection,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  const where = filter?.filters?.length ? ` WHERE ${filterKb(filter)}` : ''
  const sqlText = `SELECT * FROM ${quoteKb(tableName)}${where} LIMIT ${limit} OFFSET ${offset}`
  const result = await executeKbQuery(connection, databaseName, sqlText)
  return result.success && result.rows ? { ...result, message: `已加载 ${result.rows.length} 行数据` } : result
}

export const updateKbRow = async (connection: AdapterConnection, _databaseName: string, input: QueryUpdateRowInput): Promise<ConnectionActionResult> => {
  const pool = await getKbPool(connection)
  const changes = Object.keys(input.changes)
  const setClauses = changes.map((col) => `${quoteKb(col)} = ${quoteLiteral(String(input.changes[col]))}`)
  const whereClauses = Object.keys(input.primaryKeyValues).map((col) => `${quoteKb(col)} = ${quoteLiteral(String(input.primaryKeyValues[col]))}`)
  const result = await pool.query(`UPDATE ${quoteKb(input.tableName)} SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`)
  const affected = result.rowCount ?? 0
  return { success: true, message: affected ? '数据已保存' : '数据没有变化' }
}

export const deleteKbRow = async (connection: AdapterConnection, _databaseName: string, input: QueryDeleteRowInput): Promise<ConnectionActionResult> => {
  const pool = await getKbPool(connection)
  const whereClauses = Object.keys(input.primaryKeyValues).map((col) => `${quoteKb(col)} = ${quoteLiteral(String(input.primaryKeyValues[col]))}`)
  const result = await pool.query(`DELETE FROM ${quoteKb(input.tableName)} WHERE ${whereClauses.join(' AND ')}`)
  const affected = result.rowCount ?? 0
  return affected ? { success: true, message: '数据已删除' } : { success: false, message: '未找到该数据，可能已被修改或删除' }
}

export const getKbTableDefinition = async (connection: AdapterConnection, _databaseName: string, tableName: string): Promise<TableDefinitionResult> => {
  const pool = await getKbPool(connection)

  try {
    const colResult = await pool.query<{ column_name: string; data_type: string; nullable: boolean; is_pk: boolean; default_value: string | null; comment: string }>(
      `SELECT a.attname AS "column_name",
       pg_catalog.format_type(a.atttypid, a.atttypmod) AS "data_type",
       NOT a.attnotnull AS "nullable",
       COALESCE((SELECT true FROM pg_catalog.pg_index i
        WHERE i.indrelid = a.attrelid AND a.attnum = ANY(i.indkey) AND i.indisprimary), false) AS "is_pk",
       pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS "default_value",
       COALESCE(pg_catalog.col_description(a.attrelid, a.attnum), '') AS "comment"
       FROM pg_catalog.pg_attribute a
       LEFT JOIN pg_catalog.pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
       ORDER BY a.attnum`,
      [`public.${tableName}`]
    )

    if (!colResult.rows.length) return { success: false, message: '数据表不存在或没有字段' }

    const idxResult = await pool.query<{ index_name: string; is_unique: boolean; column_name: string }>(
      `SELECT i.relname AS "index_name", ix.indisunique AS "is_unique", a.attname AS "column_name"
       FROM pg_catalog.pg_index ix
       JOIN pg_catalog.pg_class i ON ix.indexrelid = i.oid
       JOIN pg_catalog.pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ANY(ix.indkey)
       WHERE ix.indrelid = $1::regclass AND NOT ix.indisprimary
       ORDER BY i.relname, array_position(ix.indkey, a.attnum)`,
      [`public.${tableName}`]
    )
    const indexMap = new Map<string, { name: string; type: 'UNIQUE' | 'INDEX'; columns: string[] }>()
    for (const row of idxResult.rows) {
      const idx = indexMap.get(row.index_name) ?? { name: row.index_name, type: row.is_unique ? 'UNIQUE' as const : 'INDEX' as const, columns: [] }
      idx.columns.push(row.column_name)
      indexMap.set(row.index_name, idx)
    }

    const fkResult = await pool.query<{ fk_name: string; column_name: string; ref_table: string; ref_column: string; on_delete: string; on_update: string }>(
      `SELECT c.conname AS "fk_name",
       (SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS "column_name",
       cc.relname AS "ref_table",
       (SELECT a.attname FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) AS "ref_column",
       CASE c.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS "on_delete",
       CASE c.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS "on_update"
       FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_class cc ON c.confrelid = cc.oid
       WHERE c.conrelid = $1::regclass AND c.contype = 'f'`,
      [`public.${tableName}`]
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
        notNull: !c.nullable,
        primaryKey: c.is_pk,
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
