import { createClient, type ClickHouseClient } from '@clickhouse/client'
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
  TableDataFilter,
  TableDefinitionResult,
  MySQLColumnType
} from '@/shared/connections'
import type { AdapterConnection } from './postgresql-adapter'

// ── helpers ────────────────────────────────────────────────────────────

const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`

const normalizedColumnType = (dataType: string): MySQLColumnType => {
  const type = dataType.toLowerCase()
  if (type.includes('uint64') || type.includes('uint128') || type.includes('uint256')) return 'BIGINT'
  if (type.includes('uint32') || type.includes('uint16') || type.includes('uint8')) return 'INT'
  if (type.includes('int64') || type.includes('int128') || type.includes('int256')) return 'BIGINT'
  if (type.includes('int32') || type.includes('int16') || type.includes('int8')) return 'INT'
  if (type.includes('float64') || type.includes('float32')) return 'DOUBLE'
  if (type.includes('decimal')) return 'DECIMAL'
  if (type === 'string' || type.includes('fixedstring')) return 'VARCHAR'
  if (type.includes('datetime')) return 'DATETIME'
  if (type === 'date' || type === 'date32') return 'DATE'
  if (type === 'uuid') return 'UUID'
  if (type.includes('array')) return 'JSON'
  if (type.includes('map') || type.includes('tuple') || type.includes('nullable')) return 'JSON'
  if (type === 'bool' || type === 'boolean') return 'BOOLEAN'
  if (type.includes('enum')) return 'VARCHAR'
  return 'TEXT'
}

const filterClickHouse = (filter: TableDataFilter): string => {
  const column = `\`${filter.column}\``
  const textValue = quoteLiteral(filter.value)
  const textColumn = `toString(${column})`
  const conditions: Record<TableDataFilter['operator'], string> = {
    equals: `${column} = ${textValue}`,
    notEquals: `${column} != ${textValue}`,
    contains: `${textColumn} LIKE ${quoteLiteral(`%${filter.value}%`)}`,
    startsWith: `${textColumn} LIKE ${quoteLiteral(`${filter.value}%`)}`,
    greaterThan: `${column} > ${textValue}`,
    greaterThanOrEqual: `${column} >= ${textValue}`,
    lessThan: `${column} < ${textValue}`,
    lessThanOrEqual: `${column} <= ${textValue}`,
    isEmpty: `${textColumn} = ''`,
    isEmptyOrNull: `(${column} IS NULL OR ${textColumn} = '')`,
    isNotEmpty: `(${column} IS NOT NULL AND ${textColumn} != '')`,
    isNull: `${column} IS NULL`,
    isNotNull: `${column} IS NOT NULL`
  }
  return conditions[filter.operator]
}

// ── ClickHouse client cache ───────────────────────────────────────────

const chClients = new Map<string, ClickHouseClient>()
const chLastAccess = new Map<string, number>()

const getChClient = async (connection: AdapterConnection): Promise<ClickHouseClient> => {
  const key = connection.id != null && connection.id > 0
    ? `id:${connection.id}`
    : `${connection.host}:${connection.port}:${connection.username}`
  const existing = chClients.get(key)
  if (existing) { chLastAccess.set(key, Date.now()); return existing }

  const protocol = connection.sslEnabled ? 'https' : 'http'
  const client = createClient({
    url: `${protocol}://${connection.host}:${connection.port || 8123}`,
    username: connection.username || 'default',
    password: connection.password || '',
    database: connection.defaultDatabase || 'default',
    request_timeout: 30000,
    clickhouse_settings: {
      max_execution_time: 60,
      max_result_rows: String(QUERY_ROW_LIMIT)
    }
  })
  chClients.set(key, client)
  chLastAccess.set(key, Date.now())
  return client
}

export const closeChClient = async (connection: AdapterConnection): Promise<void> => {
  const prefix = connection.id != null && connection.id > 0
    ? `id:${connection.id}`
    : `${connection.host}:${connection.port}:${connection.username}`
  for (const [key, client] of chClients) {
    if (key === prefix) {
      try { await client.close() } catch { /* ignore */ }
      chClients.delete(key)
    }
  }
}

/** 驱逐空闲超过 maxIdleMs 的客户端 */
export const evictIdleChClients = async (maxIdleMs: number): Promise<void> => {
  const now = Date.now()
  for (const [key, client] of chClients) {
    if (now - (chLastAccess.get(key) ?? 0) > maxIdleMs) {
      try { await client.close() } catch { /* ignore */ }
      chClients.delete(key)
      chLastAccess.delete(key)
    }
  }
}

// ── ClickHouse functions ──────────────────────────────────────────────

export const readChDatabases = async (connection: AdapterConnection, options?: { light?: boolean }): Promise<DatabaseItem[]> => {
  const client = await getChClient(connection)
  const result = await client.query({
    query: `SELECT name, default_character_set_name AS charset, default_collation_name AS collation FROM system.databases ORDER BY name`,
    format: 'JSONEachRow'
  })
  const databases = await result.json() as Array<{ name: string; charset: string; collation: string }>

  if (options?.light) {
    const tableResult = await client.query({
      query: `SELECT database, name AS tableName FROM system.tables WHERE database NOT IN ('system', 'information_schema', 'INFORMATION_SCHEMA') ORDER BY database, name`,
      format: 'JSONEachRow'
    })
    const tables = await tableResult.json() as Array<{ database: string; tableName: string }>
    const tablesByDb = new Map<string, DatabaseItem['tables']>()
    for (const t of tables) {
      const list = tablesByDb.get(t.database) ?? []
      list.push({ name: t.tableName, comment: '', columns: [], indexes: [], foreignKeys: [], checks: [], triggers: [] })
      tablesByDb.set(t.database, list)
    }
    return databases.map((db) => ({
      name: db.name,
      charset: db.charset || 'UTF-8',
      collation: db.collation || '',
      tables: tablesByDb.get(db.name) ?? [],
      views: [],
      functions: [],
      procedures: [],
      indexes: [],
      triggers: []
    }))
  }

  const items: DatabaseItem[] = []
  for (const db of databases) {
    try {
      const [tableResult, viewResult] = await Promise.all([
        client.query({
          query: `SELECT name, comment FROM system.tables WHERE database = '${db.name}' AND engine != 'View' ORDER BY name`,
          format: 'JSONEachRow'
        }),
        client.query({
          query: `SELECT name FROM system.tables WHERE database = '${db.name}' AND engine = 'View' ORDER BY name`,
          format: 'JSONEachRow'
        })
      ])
      const tableRows = await tableResult.json() as Array<{ name: string; comment: string }>
      const viewRows = await viewResult.json() as Array<{ name: string }>

      const tableItems: DatabaseItem['tables'] = []
      for (const t of tableRows) {
        const [colResult, idxResult] = await Promise.all([
          client.query({
            query: `SELECT name, type, is_in_primary_key, is_in_partition_key, comment FROM system.columns WHERE database = '${db.name}' AND table = '${t.name}' ORDER BY position`,
            format: 'JSONEachRow'
          }),
          client.query({
            query: `SELECT name, type, expr FROM system.indices WHERE database = '${db.name}' AND table = '${t.name}'`,
            format: 'JSONEachRow'
          })
        ])
        const cols = await colResult.json() as Array<{ name: string; type: string; is_in_primary_key: number; is_in_partition_key: number; comment: string }>
        const idxs = await idxResult.json() as Array<{ name: string; type: string; expr: string }>
        tableItems.push({
          name: t.name,
          comment: t.comment || '',
          columns: cols.map((c) => ({
            name: c.name,
            type: c.type,
            nullable: !c.is_in_primary_key,
            isPrimaryKey: c.is_in_primary_key === 1,
            comment: c.comment || undefined
          })),
          indexes: idxs.map((i) => i.name),
          foreignKeys: [],
          checks: [],
          triggers: []
        })
      }
      items.push({
        name: db.name,
        charset: db.charset || 'UTF-8',
        collation: db.collation || '',
        tables: tableItems,
        views: viewRows.map((v) => v.name),
        functions: [],
        procedures: [],
        indexes: [],
        triggers: []
      })
    } catch {
      items.push({
        name: db.name,
        charset: db.charset || 'UTF-8',
        collation: db.collation || '',
        tables: [],
        views: [],
        functions: [],
        procedures: [],
        indexes: [],
        triggers: []
      })
    }
  }
  return items
}

export const executeChQuery = async (connection: AdapterConnection, databaseName: string, sqlText: string): Promise<QueryExecutionResult> => {
  const client = await getChClient(connection)
  const startTime = new Date().toISOString()
  const startMs = performance.now()

  try {
    const isSelect = isSelectQuery(sqlText)
    const execSql = isSelect ? applyLimit(sqlText, QUERY_ROW_LIMIT) : sqlText

    const result = await client.query({
      query: execSql,
      format: 'JSON',
      clickhouse_settings: databaseName ? { database: databaseName } : undefined
    })
    const payload = await result.json() as {
      meta?: Array<{ name: string }>
      data?: Array<Record<string, unknown>>
    }
    const rows = payload.data ?? []
    const columns = payload.meta?.map((column) => column.name) ?? (rows[0] ? Object.keys(rows[0]) : [])
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)

    if (isSelect || columns.length > 0) {
      const truncated = isSelect && rows.length >= QUERY_ROW_LIMIT

      let cursorId: string | undefined
      if (truncated) {
        const cursor = createCursor({
          connectionId: connection.id,
          engine: 'ClickHouse',
          connectionKey: `${connection.host}:${connection.port}/${databaseName}`,
          databaseName: databaseName || 'default',
          sql: sqlText,
          columns,
          offset: rows.length,
          totalRows: rows.length
        })
        cursorId = cursor.id
      }

      const msg = truncated ? `查询成功，显示前 ${rows.length} 行` : `查询成功，共 ${rows.length} 行`
      return {
        success: true,
        message: msg,
        columns,
        rows,
        startTime,
        endTime,
        durationMs,
        queryCount: 1,
        successCount: 1,
        errorCount: 0,
        truncated,
        cursorId
      }
    }

    return {
      success: true,
      message: '执行成功',
      startTime,
      endTime,
      durationMs,
      queryCount: 1,
      successCount: 1,
      errorCount: 0
    }
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return {
      success: false,
      message: error instanceof Error ? error.message : '查询执行失败',
      startTime,
      endTime,
      durationMs,
      queryCount: 1,
      successCount: 0,
      errorCount: 1
    }
  }
}

export const fetchMoreChRows = async (
  connection: AdapterConnection,
  databaseName: string,
  cursor: QueryCursor,
  count: number = QUERY_ROW_LIMIT
): Promise<{ rows: Array<Record<string, unknown>>; done: boolean }> => {
  const client = await getChClient(connection)
  const limitedSql = applyLimitOffset(cursor.sql, count, cursor.offset)
  const result = await client.query({
    query: limitedSql,
    format: 'JSONEachRow',
    clickhouse_settings: databaseName ? { database: databaseName } : undefined
  })
  const rows = await result.json() as Array<Record<string, unknown>>
  const done = rows.length < count
  updateCursorOffset(cursor.id, cursor.offset + rows.length)
  if (done) deleteCursor(cursor.id)
  return { rows, done }
}

export const readChTableData = async (
  connection: AdapterConnection,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  const where = filter?.column ? ` WHERE ${filterClickHouse(filter)}` : ''
  const sqlText = `SELECT * FROM \`${tableName}\`${where} LIMIT ${limit} OFFSET ${offset}`
  const result = await executeChQuery(connection, databaseName, sqlText)
  return result.success && result.rows ? { ...result, message: `已加载 ${result.rows.length} 行数据` } : result
}

export const updateChRow = async (_connection: AdapterConnection, _databaseName: string, _input: QueryUpdateRowInput): Promise<ConnectionActionResult> => {
  return { success: false, message: 'ClickHouse 不支持直接更新行数据，请使用 ALTER TABLE ... UPDATE 或重新插入数据' }
}

export const deleteChRow = async (_connection: AdapterConnection, _databaseName: string, _input: QueryDeleteRowInput): Promise<ConnectionActionResult> => {
  return { success: false, message: 'ClickHouse 不支持直接删除行数据，请使用 ALTER TABLE ... DELETE 或轻量删除' }
}

export const getChTableDefinition = async (connection: AdapterConnection, databaseName: string, tableName: string): Promise<TableDefinitionResult> => {
  const client = await getChClient(connection)

  try {
    const colResult = await client.query({
      query: `SELECT name, type, is_in_primary_key, is_in_partition_key, is_in_sorting_key, is_in_order_by_key, default_expression, comment
              FROM system.columns WHERE database = '${databaseName}' AND table = '${tableName}' ORDER BY position`,
      format: 'JSONEachRow'
    })
    const cols = await colResult.json() as Array<{
      name: string; type: string; is_in_primary_key: number; is_in_partition_key: number;
      is_in_sorting_key: number; is_in_order_by_key: number; default_expression: string; comment: string
    }>

    if (!cols.length) return { success: false, message: '数据表不存在或没有字段' }

    const idxResult = await client.query({
      query: `SELECT name, type, expr FROM system.indices WHERE database = '${databaseName}' AND table = '${tableName}'`,
      format: 'JSONEachRow'
    })
    const idxs = await idxResult.json() as Array<{ name: string; type: string; expr: string }>

    return {
      success: true,
      message: '表结构读取成功',
      tableName,
      tableComment: '',
      columns: cols.map((c) => ({
        name: c.name,
        originalName: c.name,
        type: normalizedColumnType(c.type),
        typeDefinition: c.type,
        length: '',
        decimals: '',
        notNull: true,
        primaryKey: c.is_in_primary_key === 1,
        comment: c.comment || '',
        defaultValue: c.default_expression || undefined
      })),
      indexes: idxs.map((i) => ({
        name: i.name,
        type: (i.type === 'PRIMARY' ? 'INDEX' : i.type.includes('UNIQUE') ? 'UNIQUE' : 'INDEX') as 'INDEX' | 'UNIQUE',
        columns: i.expr ? [i.expr] : []
      })),
      foreignKeys: []
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '读取表结构失败' }
  }
}
