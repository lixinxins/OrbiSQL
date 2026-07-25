import { basename } from 'node:path'
import duckdb from 'duckdb'
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
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput,
  TableColumn,
  TableDataFilter,
  TableDefinitionResult,
  TableForeignKeyDefinition,
  TableIndexDefinition,
  MySQLColumnType
} from '@/shared/connections'
import type { AdapterConnection } from './postgresql-adapter'

// ── promisify duckdb callback API ─────────────────────────────────────

type DuckDbDatabase = InstanceType<typeof duckdb.Database>

const dbAll = <T = Record<string, unknown>>(db: DuckDbDatabase, sql: string, ...params: unknown[]): Promise<T[]> =>
  new Promise((resolve, reject) => {
    ;(db as any).all(sql, ...params, (err: Error | null, rows: T[]) => {
      if (err) reject(err)
      else resolve(rows ?? [])
    })
  })

const dbRun = (db: DuckDbDatabase, sql: string, ...params: unknown[]): Promise<{ changes: number }> =>
  new Promise((resolve, reject) => {
    db.run(sql, ...params, function (this: { changes: number }, err: Error | null) {
      if (err) reject(err)
      else resolve({ changes: this?.changes ?? 0 })
    })
  })

const dbExec = (db: DuckDbDatabase, sql: string): Promise<void> =>
  new Promise((resolve, reject) => {
    db.exec(sql, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })

const dbClose = (db: DuckDbDatabase): Promise<void> =>
  new Promise((resolve, reject) => {
    db.close((err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })

// ── helpers ────────────────────────────────────────────────────────────

const quoteDuckDb = (value: string): string => `"${value.replaceAll('"', '""')}"`
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`

const normalizedColumnType = (dataType: string): MySQLColumnType => {
  const type = dataType.toLowerCase()
  if (type.includes('bigint')) return 'BIGINT'
  if (type.includes('smallint')) return 'SMALLINT'
  if (type === 'integer' || type === 'int' || type.includes('serial')) return 'INT'
  if (type.includes('double') || type === 'float8') return 'DOUBLE'
  if (type.includes('real') || type === 'float' || type === 'float4') return 'FLOAT'
  if (type.includes('numeric') || type.includes('decimal')) return 'DECIMAL'
  if (type.includes('bool')) return 'BOOLEAN'
  if (type.includes('json')) return 'JSON'
  if (type.includes('timestamp') || type.includes('datetime')) return 'DATETIME'
  if (type === 'date') return 'DATE'
  if (type.includes('time')) return 'TIME'
  if (type.includes('blob') || type.includes('bytea') || type.includes('binary')) return 'BLOB'
  if (type.includes('varchar') || type.includes('char') || type.includes('text') || type.includes('string')) return 'VARCHAR'
  return 'TEXT'
}

const filterDuckDb = (filter: TableDataFilter): string => {
  const column = quoteDuckDb(filter.column)
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

// ── DuckDB handle cache ──────────────────────────────────────────────

const duckDbHandles = new Map<string, DuckDbDatabase>()

const ensureDuckDbHandle = async (connection: AdapterConnection): Promise<DuckDbDatabase> => {
  const filePath = connection.host
  const existing = duckDbHandles.get(filePath)
  if (existing) return existing
  const db = new duckdb.Database(filePath)
  duckDbHandles.set(filePath, db)
  return db
}

/** 关闭 DuckDB 文件句柄 */
export const closeDuckDbHandle = async (connection: AdapterConnection): Promise<void> => {
  const filePath = connection.host
  const db = duckDbHandles.get(filePath)
  if (db) {
    duckDbHandles.delete(filePath)
    await dbClose(db)
  }
}

// ── DuckDB functions ──────────────────────────────────────────────────

export const readDuckDbDatabases = async (_connection: AdapterConnection, options?: { light?: boolean }): Promise<DatabaseItem[]> => {
  const db = await ensureDuckDbHandle(_connection)

  const tableRows = await dbAll<{ table_name: string; comment: string | null }>(
    db,
    `SELECT table_name, COALESCE(comment, '') AS comment FROM duckdb_tables() WHERE table_schema = 'main' ORDER BY table_name`
  )
  const viewRows = await dbAll<{ view_name: string }>(
    db,
    `SELECT view_name FROM duckdb_views() WHERE schema_name = 'main' AND NOT internal ORDER BY view_name`
  )

  if (options?.light) {
    const tables: DatabaseItem['tables'] = tableRows.map((table) => ({
      name: table.table_name,
      comment: table.comment || '',
      columns: [] as TableColumn[],
      indexes: [] as string[],
      foreignKeys: [] as string[],
      checks: [] as string[],
      triggers: [] as string[]
    }))
    return [{
      name: basename(_connection.host),
      tables,
      views: viewRows.map((v) => v.view_name),
      functions: [],
      procedures: [],
      indexes: [],
      triggers: []
    }]
  }

  const tables: DatabaseItem['tables'] = []
  for (const table of tableRows) {
    const columns = await dbAll<{ column_name: string; data_type: string; is_nullable: string; is_primary_key: boolean }>(
      db,
      `SELECT column_name, data_type, is_nullable,
        COALESCE((SELECT true FROM duckdb_constraints()
          WHERE schema_name = 'main' AND table_name = ? AND constraint_type = 'PRIMARY KEY'
          AND column_names LIKE '%' || column_name || '%'), false) AS is_primary_key
       FROM duckdb_columns() WHERE schema_name = 'main' AND table_name = ? ORDER BY column_index`,
      table.table_name, table.table_name
    )
    const indexes = await dbAll<{ index_name: string }>(
      db,
      `SELECT index_name FROM duckdb_indexes() WHERE schema_name = 'main' AND table_name = ? ORDER BY index_name`,
      table.table_name
    )
    tables.push({
      name: table.table_name,
      comment: table.comment || '',
      columns: columns.map((col) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES',
        isPrimaryKey: col.is_primary_key,
        comment: undefined
      })),
      indexes: indexes.map((idx) => idx.index_name),
      foreignKeys: [],
      checks: [],
      triggers: []
    })
  }
  return [{
    name: basename(_connection.host),
    tables,
    views: viewRows.map((v) => v.view_name),
    functions: [],
    procedures: [],
    indexes: [],
    triggers: []
  }]
}

export const executeDuckDbQuery = async (connection: AdapterConnection, sql: string): Promise<QueryExecutionResult> => {
  const db = await ensureDuckDbHandle(connection)
  const startTime = new Date().toISOString()
  const startMs = performance.now()
  try {
    const isSelect = isSelectQuery(sql)
    const limitedSql = isSelect ? applyLimit(sql, QUERY_ROW_LIMIT) : sql

    if (isSelect) {
      const rows = await dbAll(db, limitedSql)
      const endTime = new Date().toISOString()
      const durationMs = Math.round(performance.now() - startMs)
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      const truncated = rows.length >= QUERY_ROW_LIMIT

      let editable: QueryExecutionResult['editable']
      const tableName = sql.match(/\bFROM\s+"?([A-Za-z0-9_$]+)"?/i)?.[1]
      if (tableName) {
        const pkRows = await dbAll<{ column_name: string }>(
          db,
          `SELECT unnest(constraint_column_names) AS column_name FROM duckdb_constraints()
           WHERE schema_name = 'main' AND table_name = ? AND constraint_type = 'PRIMARY KEY'`,
          tableName
        )
        const primaryKeys = pkRows.map((r) => r.column_name)
        if (primaryKeys.length && primaryKeys.every((key) => columns.includes(key))) {
          const validColumns = new Set(columns)
          editable = {
            tableName,
            primaryKeys,
            columns: columns.filter((column) => validColumns.has(column)).map((column) => ({
              resultName: column, sourceName: column, primaryKey: primaryKeys.includes(column)
            }))
          }
        }
      }

      let cursorId: string | undefined
      if (truncated) {
        const cursor = createCursor({
          engine: 'DuckDB',
          connectionKey: connection.host,
          databaseName: '',
          sql,
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

    // Non-SELECT statement
    const result = await dbRun(db, limitedSql)
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return {
      success: true, message: `执行成功，影响 ${result.changes} 行`, affectedRows: result.changes,
      startTime, endTime, durationMs, queryCount: 1, successCount: 1, errorCount: 0
    }
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return { success: false, message: error instanceof Error ? error.message : '查询执行失败', startTime, endTime, durationMs, queryCount: 1, successCount: 0, errorCount: 1 }
  }
}

/** 通过游标获取更多 DuckDB 行 */
export const fetchMoreDuckDbRows = async (
  connection: AdapterConnection,
  cursor: QueryCursor,
  count: number = QUERY_ROW_LIMIT
): Promise<{ rows: Array<Record<string, unknown>>; done: boolean }> => {
  const db = await ensureDuckDbHandle(connection)
  const limitedSql = applyLimitOffset(cursor.sql, count, cursor.offset)
  const rows = await dbAll(db, limitedSql)
  const done = rows.length < count
  updateCursorOffset(cursor.id, cursor.offset + rows.length)
  if (done) deleteCursor(cursor.id)
  return { rows, done }
}

export const readDuckDbTableData = async (
  connection: AdapterConnection,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  if (filter?.column) {
    const db = await ensureDuckDbHandle(connection)
    const cols = await dbAll<{ column_name: string }>(
      db,
      `SELECT column_name FROM duckdb_columns() WHERE schema_name = 'main' AND table_name = ?`,
      tableName
    )
    if (!cols.some((c) => c.column_name === filter.column)) return { success: false, message: '筛选字段不存在' }
  }
  const where = filter?.column ? ` WHERE ${filterDuckDb(filter)}` : ''
  const result = await executeDuckDbQuery(connection, `SELECT * FROM ${quoteDuckDb(tableName)}${where} LIMIT ${limit} OFFSET ${offset}`)
  return result.success && result.rows ? { ...result, message: `已加载 ${result.rows.length} 行数据` } : result
}

export const updateDuckDbRow = async (connection: AdapterConnection, input: QueryUpdateRowInput): Promise<ConnectionActionResult> => {
  const db = await ensureDuckDbHandle(connection)
  const pkRows = await dbAll<{ column_name: string }>(
    db,
    `SELECT unnest(constraint_column_names) AS column_name FROM duckdb_constraints()
     WHERE schema_name = 'main' AND table_name = ? AND constraint_type = 'PRIMARY KEY'`,
    input.tableName
  )
  const primaryKeys = pkRows.map((r) => r.column_name)
  if (!primaryKeys.length || primaryKeys.some((key) => !(key in input.primaryKeyValues))) {
    return { success: false, message: '查询结果缺少完整主键，无法安全保存' }
  }
  const changes = Object.keys(input.changes)
  const colRows = await dbAll<{ column_name: string }>(
    db,
    `SELECT column_name FROM duckdb_columns() WHERE schema_name = 'main' AND table_name = ?`,
    input.tableName
  )
  const validColumns = new Set(colRows.map((c) => c.column_name))
  if (changes.some((column) => !validColumns.has(column))) return { success: false, message: '包含无效字段，无法保存' }

  const params = [...changes.map((column) => input.changes[column]), ...primaryKeys.map((column) => input.primaryKeyValues[column])]
  const result = await dbRun(
    db,
    `UPDATE ${quoteDuckDb(input.tableName)} SET ${changes.map((column) => `${quoteDuckDb(column)} = ?`).join(', ')} WHERE ${primaryKeys.map((column) => `${quoteDuckDb(column)} IS ?`).join(' AND ')}`,
    ...params
  )
  return { success: true, message: result.changes ? '数据已保存' : '数据没有变化' }
}

export const deleteDuckDbRow = async (connection: AdapterConnection, input: QueryDeleteRowInput): Promise<ConnectionActionResult> => {
  const db = await ensureDuckDbHandle(connection)
  const pkRows = await dbAll<{ column_name: string }>(
    db,
    `SELECT unnest(constraint_column_names) AS column_name FROM duckdb_constraints()
     WHERE schema_name = 'main' AND table_name = ? AND constraint_type = 'PRIMARY KEY'`,
    input.tableName
  )
  const primaryKeys = pkRows.map((r) => r.column_name)
  if (!primaryKeys.length || primaryKeys.some((key) => !(key in input.primaryKeyValues))) {
    return { success: false, message: '缺少完整主键，无法安全删除数据' }
  }
  const result = await dbRun(
    db,
    `DELETE FROM ${quoteDuckDb(input.tableName)} WHERE ${primaryKeys.map((column) => `${quoteDuckDb(column)} IS ?`).join(' AND ')}`,
    ...primaryKeys.map((column) => input.primaryKeyValues[column])
  )
  return result.changes
    ? { success: true, message: '数据已删除' }
    : { success: false, message: '未找到该数据，可能已被修改或删除' }
}

export const getDuckDbTableDefinition = async (connection: AdapterConnection, tableName: string): Promise<TableDefinitionResult> => {
  const db = await ensureDuckDbHandle(connection)
  const columns = await dbAll<{
    column_name: string; data_type: string; is_nullable: string; column_default: string | null
  }>(
    db,
    `SELECT column_name, data_type, is_nullable, column_default
     FROM duckdb_columns() WHERE schema_name = 'main' AND table_name = ? ORDER BY column_index`,
    tableName
  )
  if (!columns.length) return { success: false, message: '数据表不存在或没有字段' }

  const pkRows = await dbAll<{ column_name: string }>(
    db,
    `SELECT unnest(constraint_column_names) AS column_name FROM duckdb_constraints()
     WHERE schema_name = 'main' AND table_name = ? AND constraint_type = 'PRIMARY KEY'`,
    tableName
  )
  const primaryKeys = new Set(pkRows.map((r) => r.column_name))

  const indexRows = await dbAll<{ index_name: string; is_unique: boolean }>(
    db,
    `SELECT DISTINCT index_name, is_unique FROM duckdb_indexes() WHERE schema_name = 'main' AND table_name = ?`,
    tableName
  )
  const indexes: TableIndexDefinition[] = await Promise.all(
    indexRows.map(async (idx) => {
      const colRows = await dbAll<{ column_name: string }>(
        db,
        `SELECT unnest(column_names) AS column_name FROM duckdb_indexes() WHERE index_name = ? AND schema_name = 'main'`,
        idx.index_name
      )
      return { name: idx.index_name, type: idx.is_unique ? 'UNIQUE' : 'INDEX', columns: colRows.map((c) => c.column_name) }
    })
  )

  const fkRows = await dbAll<{
    constraint_column_names: string; referenced_table: string; referenced_column_names: string
  }>(
    db,
    `SELECT constraint_column_names, referenced_table, referenced_column_names
     FROM duckdb_constraints() WHERE schema_name = 'main' AND table_name = ? AND constraint_type = 'FOREIGN KEY'`,
    tableName
  )
  const foreignKeys: TableForeignKeyDefinition[] = fkRows.map((fk, i) => {
    const cols = JSON.parse(fk.constraint_column_names || '[]') as string[]
    const refCols = JSON.parse(fk.referenced_column_names || '[]') as string[]
    return {
      name: `FK_${i}`,
      column: cols[0] ?? '',
      referencedTable: fk.referenced_table,
      referencedColumn: refCols[0] ?? '',
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION'
    }
  })

  return {
    success: true,
    message: '表结构读取成功',
    tableName,
    tableComment: '',
    columns: columns.map((column) => ({
      name: column.column_name,
      originalName: column.column_name,
      type: normalizedColumnType(column.data_type),
      typeDefinition: column.data_type,
      length: column.data_type.match(/\((\d+)/)?.[1] ?? '',
      decimals: column.data_type.match(/\(\d+\s*,\s*(\d+)\)/)?.[1] ?? '',
      notNull: column.is_nullable === 'NO',
      primaryKey: primaryKeys.has(column.column_name),
      comment: '',
      defaultValue: column.column_default
    })),
    indexes,
    foreignKeys
  }
}

export const executeDuckDbFile = async (connection: AdapterConnection, sql: string): Promise<void> => {
  const db = await ensureDuckDbHandle(connection)
  await dbExec(db, sql)
}
