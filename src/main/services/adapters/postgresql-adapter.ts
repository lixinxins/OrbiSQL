import { createWriteStream } from 'node:fs'
import { Client, Pool, type PoolClient } from 'pg'
import { buildSslConfig, type SslConnectionConfig } from '../ssl-helper'
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
  CreateTableInput,
  DatabaseItem,
  SchemaItem,
  ExportSqlProgress,
  MySQLColumnType,
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput,
  TableColumn,
  TableColumnDefinition,
  TableDataFilter,
  TableDefinitionResult,
  TableForeignKeyDefinition,
  TableIndexDefinition
} from '@/shared/connections'
import type { StoredConnection } from '../../database/connection-repository'
import { dbWorkerPgQuery } from '../db-query-runtime'

export type AdapterConnection = Pick<StoredConnection, 'host' | 'port' | 'username' | 'password' | 'defaultDatabase'> &
  SslConnectionConfig

export interface ReadDatabasesOptions {
  /** 仅返回库名和表名，跳过列/索引/外键/触发器等详细元数据 */
  light?: boolean
}

// ── helpers ────────────────────────────────────────────────────────────

const quotePg = (value: string): string => `"${value.replaceAll('"', '""')}"`
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`

const postgresDumpValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (Buffer.isBuffer(value)) return `decode('${value.toString('hex')}', 'hex')`
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `'${text.replaceAll("'", "''")}'`
}

const writeStreamChunk = (stream: ReturnType<typeof createWriteStream>, chunk: string): Promise<void> =>
  new Promise((resolve, reject) => {
    if (stream.write(chunk, 'utf8')) return resolve()
    stream.once('drain', resolve)
    stream.once('error', reject)
  })

const closeWriteStream = (stream: ReturnType<typeof createWriteStream>): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.once('finish', resolve)
    stream.once('error', reject)
    stream.end()
  })

const filterSql = (filter: TableDataFilter): string => {
  const column = quotePg(filter.column)
  const textValue = quoteLiteral(filter.value)
  const textColumn = `CAST(${column} AS TEXT)`
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

const groupBy = <Row>(rows: Row[], key: (row: Row) => string, value: (row: Row) => string): Map<string, string[]> => {
  const groups = new Map<string, string[]>()
  rows.forEach((row) => groups.set(key(row), [...(groups.get(key(row)) ?? []), value(row)]))
  return groups
}

const portableType = (column: TableColumnDefinition): string => {
  const mappings: Partial<Record<MySQLColumnType, string>> = {
    TINYINT: 'SMALLINT', MEDIUMINT: 'INTEGER', INT: 'INTEGER', DOUBLE: 'DOUBLE PRECISION',
    TINYTEXT: 'TEXT', MEDIUMTEXT: 'TEXT', LONGTEXT: 'TEXT', TINYBLOB: 'BYTEA', BLOB: 'BYTEA',
    MEDIUMBLOB: 'BYTEA', LONGBLOB: 'BYTEA', BINARY: 'BYTEA', VARBINARY: 'BYTEA', DATETIME: 'TIMESTAMP',
    YEAR: 'SMALLINT', JSON: 'JSONB', ENUM: 'TEXT', SET: 'TEXT'
  }
  if (column.type === 'VARCHAR' || column.type === 'CHAR') return `${column.type}(${column.length || '255'})`
  if (column.type === 'DECIMAL') return `DECIMAL(${column.length || '10'},${column.decimals || '0'})`
  return mappings[column.type] ?? column.type
}

const portableColumn = (column: TableColumnDefinition): string => {
  const parts = [quotePg(column.name), portableType(column)]
  if (column.notNull || column.primaryKey) parts.push('NOT NULL')
  if (column.defaultValue === null) parts.push('DEFAULT NULL')
  else if (column.defaultValue !== undefined) {
    parts.push(/^(CURRENT_TIMESTAMP|NULL)$/i.test(column.defaultValue) ? `DEFAULT ${column.defaultValue}` : `DEFAULT ${quoteLiteral(String(column.defaultValue))}`)
  }
  return parts.join(' ')
}

const normalizedColumnType = (dataType: string): MySQLColumnType => {
  const type = dataType.toLowerCase()
  if (type.includes('bigint')) return 'BIGINT'
  if (type.includes('smallint')) return 'SMALLINT'
  if (type === 'integer' || type === 'int' || type.includes('serial')) return 'INT'
  if (type.includes('double')) return 'DOUBLE'
  if (type.includes('real') || type.includes('float')) return 'FLOAT'
  if (type.includes('numeric') || type.includes('decimal')) return 'DECIMAL'
  if (type.includes('bool')) return 'BOOLEAN'
  if (type.includes('json')) return 'JSON'
  if (type.includes('timestamp') || type.includes('datetime')) return 'DATETIME'
  if (type === 'date') return 'DATE'
  if (type.includes('time')) return 'TIME'
  if (type.includes('blob') || type.includes('bytea') || type.includes('binary')) return 'BLOB'
  if (type.includes('char') && !type.includes('varying')) return 'CHAR'
  if (type.includes('varchar') || type.includes('varying')) return 'VARCHAR'
  return 'TEXT'
}

// ── PostgreSQL connection pool cache ──────────────────────────────────

const postgresPools = new Map<string, Pool>()

export const getPostgresPool = (connection: AdapterConnection, database?: string): Pool => {
  const dbName = database || connection.defaultDatabase || 'postgres'
  const poolKey = `${connection.host}:${connection.port}:${connection.username}:${dbName}`
  let pool = postgresPools.get(poolKey)
  if (!pool) {
    pool = new Pool({
      host: connection.host,
      port: connection.port,
      user: connection.username,
      password: connection.password,
      database: dbName,
      max: 5,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 5000,
      ssl: buildSslConfig(connection)
    })
    postgresPools.set(poolKey, pool)
  }
  return pool
}

/** 关闭与某主连接（host:port:username）关联的所有 PG 连接池 */
export const closePostgresPools = (connection: AdapterConnection): void => {
  const prefix = `${connection.host}:${connection.port}:${connection.username}:`
  for (const [key, pool] of postgresPools) {
    if (key.startsWith(prefix)) {
      postgresPools.delete(key)
      pool.end().catch(() => undefined)
    }
  }
}

/** 关闭所有 PG 连接池（应用退出时调用） */
export const closeAllPostgresPools = async (): Promise<void> => {
  const ends = Array.from(postgresPools.values()).map((pool) => pool.end().catch(() => undefined))
  postgresPools.clear()
  await Promise.allSettled(ends)
}

// ── PostgreSQL functions ──────────────────────────────────────────────

const readPostgresDatabase = async (connection: AdapterConnection, databaseName: string): Promise<DatabaseItem> => {
  const pool = getPostgresPool(connection, databaseName)
  const client = await pool.connect()
  try {
    const schemasRes = await client.query<{ name: string }>(`
      SELECT nspname AS name
      FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_temp_%'
        AND nspname NOT LIKE 'pg_toast_%'
        AND nspname NOT IN ('information_schema', 'pg_catalog')
      ORDER BY (CASE WHEN nspname = 'public' THEN 0 ELSE 1 END), nspname
    `)
    const schemaNames = schemasRes.rows.map((r) => r.name)

    const tables = await client.query<{ schemaName: string; name: string; comment: string }>(`
        SELECT n.nspname AS "schemaName", c.relname AS name, COALESCE(obj_description(c.oid, 'pg_class'), '') AS comment
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_temp_%'
          AND n.nspname NOT LIKE 'pg_toast_%'
          AND n.nspname NOT IN ('information_schema', 'pg_catalog')
          AND c.relkind = 'r'
        ORDER BY n.nspname, c.relname
      `)

    const columns = await client.query<{ schemaName: string; tableName: string; name: string; type: string; nullable: boolean; isPrimaryKey: boolean; comment: string }>(`
      SELECT c.table_schema AS "schemaName", c.table_name AS "tableName", c.column_name AS name,
             c.data_type AS type, c.is_nullable = 'YES' AS nullable,
             COALESCE(
               col_description(
                 (SELECT oid FROM pg_class WHERE relname = c.table_name AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = c.table_schema)),
                 c.ordinal_position
               ), ''
             ) AS comment,
             EXISTS (
               SELECT 1 FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
               WHERE tc.table_schema = c.table_schema AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' AND kcu.column_name = c.column_name
             ) AS "isPrimaryKey"
      FROM information_schema.columns c
      WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog')
        AND c.table_schema NOT LIKE 'pg_temp_%'
        AND c.table_schema NOT LIKE 'pg_toast_%'
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
    `)

    const indexes = await client.query<{ schemaName: string; tableName: string; name: string }>(`
      SELECT schemaname AS "schemaName", tablename AS "tableName", indexname AS name
      FROM pg_catalog.pg_indexes
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
        AND schemaname NOT LIKE 'pg_temp_%'
      ORDER BY schemaname, tablename, indexname
    `)

    const constraints = await client.query<{ schemaName: string; tableName: string; name: string; type: string }>(`
      SELECT tc.table_schema AS "schemaName", tc.table_name AS "tableName", tc.constraint_name AS name, tc.constraint_type AS type
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema NOT IN ('information_schema', 'pg_catalog')
        AND tc.table_schema NOT LIKE 'pg_temp_%'
        AND tc.constraint_type IN ('FOREIGN KEY', 'CHECK')
      ORDER BY tc.table_schema, tc.table_name, tc.constraint_name
    `)

    const triggers = await client.query<{ schemaName: string; tableName: string; name: string }>(`
      SELECT trigger_schema AS "schemaName", event_object_table AS "tableName", trigger_name AS name
      FROM information_schema.triggers
      WHERE trigger_schema NOT IN ('information_schema', 'pg_catalog')
        AND trigger_schema NOT LIKE 'pg_temp_%'
      ORDER BY trigger_schema, event_object_table, trigger_name
    `)

    const views = await client.query<{ schemaName: string; name: string }>(`
      SELECT table_schema AS "schemaName", table_name AS name
      FROM information_schema.views
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
        AND table_schema NOT LIKE 'pg_temp_%'
      ORDER BY table_schema, table_name
    `)

    const materializedViews = await client.query<{ schemaName: string; name: string }>(`
      SELECT schemaname AS "schemaName", matviewname AS name
      FROM pg_catalog.pg_matviews
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
        AND schemaname NOT LIKE 'pg_temp_%'
      ORDER BY schemaname, matviewname
    `)

    const routines = await client.query<{ schemaName: string; name: string; type: string }>(`
      SELECT routine_schema AS "schemaName", routine_name AS name, routine_type AS type
      FROM information_schema.routines
      WHERE routine_schema NOT IN ('information_schema', 'pg_catalog')
        AND routine_schema NOT LIKE 'pg_temp_%'
      ORDER BY routine_schema, routine_name
    `)

    const sequences = await client.query<{ schemaName: string; name: string }>(`
      SELECT sequence_schema AS "schemaName", sequence_name AS name
      FROM information_schema.sequences
      WHERE sequence_schema NOT IN ('information_schema', 'pg_catalog')
        AND sequence_schema NOT LIKE 'pg_temp_%'
      ORDER BY sequence_schema, sequence_name
    `)

    const extensionsRes = await client.query<{ name: string }>(`
      SELECT extname AS name FROM pg_catalog.pg_extension ORDER BY extname
    `)
    const extensions = extensionsRes.rows.map((r) => r.name)

    const typesRes = await client.query<{ schemaName: string; name: string }>(`
      SELECT n.nspname AS "schemaName", t.typname AS name
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE (t.typtype IN ('e', 'c', 'r') OR (t.typtype = 'b' AND t.typname NOT LIKE '\\_%'))
        AND n.nspname NOT IN ('information_schema', 'pg_catalog')
        AND n.nspname NOT LIKE 'pg_temp_%'
        AND n.nspname NOT LIKE 'pg_toast_%'
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c WHERE c.reltype = t.oid AND c.relkind IN ('r', 'v', 'm', 'S', 'f')
        )
      ORDER BY n.nspname, t.typname
    `)

    const domainsRes = await client.query<{ schemaName: string; name: string }>(`
      SELECT n.nspname AS "schemaName", t.typname AS name
      FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'd'
        AND n.nspname NOT IN ('information_schema', 'pg_catalog')
        AND n.nspname NOT LIKE 'pg_temp_%'
      ORDER BY n.nspname, t.typname
    `)

    const foreignTablesRes = await client.query<{ schemaName: string; name: string }>(`
      SELECT n.nspname AS "schemaName", c.relname AS name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'f'
        AND n.nspname NOT IN ('information_schema', 'pg_catalog')
        AND n.nspname NOT LIKE 'pg_temp_%'
      ORDER BY n.nspname, c.relname
    `)

    const policiesRes = await client.query<{ schemaName: string; tableName: string; name: string }>(`
      SELECT schemaname AS "schemaName", tablename AS "tableName", policyname AS name
      FROM pg_catalog.pg_policies
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
        AND schemaname NOT LIKE 'pg_temp_%'
      ORDER BY schemaname, tablename, policyname
    `)

    const columnsByTableKey = new Map<string, TableColumn[]>()
    for (const row of columns.rows) {
      const key = `${row.schemaName}.${row.tableName}`
      const cols = columnsByTableKey.get(key) ?? []
      cols.push({ name: row.name, type: row.type, nullable: row.nullable, isPrimaryKey: row.isPrimaryKey, comment: row.comment || undefined })
      columnsByTableKey.set(key, cols)
    }

    const indexesByTableKey = groupBy(indexes.rows, (row) => `${row.schemaName}.${row.tableName}`, (row) => row.name)
    const foreignKeysByTableKey = groupBy(constraints.rows.filter((row) => row.type === 'FOREIGN KEY'), (row) => `${row.schemaName}.${row.tableName}`, (row) => row.name)
    const checksByTableKey = groupBy(constraints.rows.filter((row) => row.type === 'CHECK'), (row) => `${row.schemaName}.${row.tableName}`, (row) => row.name)
    const triggersByTableKey = groupBy(triggers.rows, (row) => `${row.schemaName}.${row.tableName}`, (row) => row.name)
    const policiesByTableKey = groupBy(policiesRes.rows, (row) => `${row.schemaName}.${row.tableName}`, (row) => row.name)

    const schemaItemsMap = new Map<string, SchemaItem>()
    for (const schemaName of schemaNames) {
      schemaItemsMap.set(schemaName, {
        name: schemaName,
        tables: [],
        views: [],
        materializedViews: [],
        functions: [],
        procedures: [],
        sequences: [],
        extensions: schemaName === 'public' ? extensions : [],
        types: [],
        domains: [],
        foreignTables: []
      })
    }

    for (const t of tables.rows) {
      const schemaItem = schemaItemsMap.get(t.schemaName)
      if (!schemaItem) continue
      const tableKey = `${t.schemaName}.${t.name}`
      schemaItem.tables.push({
        name: t.name,
        comment: t.comment,
        columns: columnsByTableKey.get(tableKey) ?? [],
        indexes: indexesByTableKey.get(tableKey) ?? [],
        foreignKeys: foreignKeysByTableKey.get(tableKey) ?? [],
        checks: checksByTableKey.get(tableKey) ?? [],
        triggers: triggersByTableKey.get(tableKey) ?? [],
        policies: policiesByTableKey.get(tableKey) ?? []
      })
    }

    for (const v of views.rows) {
      const s = schemaItemsMap.get(v.schemaName)
      if (s) s.views.push(v.name)
    }

    for (const mv of materializedViews.rows) {
      const s = schemaItemsMap.get(mv.schemaName)
      if (s) {
        s.materializedViews = s.materializedViews ?? []
        s.materializedViews.push(mv.name)
      }
    }

    for (const ft of foreignTablesRes.rows) {
      const s = schemaItemsMap.get(ft.schemaName)
      if (s) {
        s.foreignTables = s.foreignTables ?? []
        s.foreignTables.push(ft.name)
      }
    }

    for (const r of routines.rows) {
      const s = schemaItemsMap.get(r.schemaName)
      if (s) {
        if (r.type === 'PROCEDURE') {
          s.procedures = s.procedures ?? []
          s.procedures.push(r.name)
        } else {
          s.functions.push(r.name)
        }
      }
    }

    for (const seq of sequences.rows) {
      const s = schemaItemsMap.get(seq.schemaName)
      if (s) {
        s.sequences = s.sequences ?? []
        s.sequences.push(seq.name)
      }
    }

    for (const typ of typesRes.rows) {
      const s = schemaItemsMap.get(typ.schemaName)
      if (s) {
        s.types = s.types ?? []
        s.types.push(typ.name)
      }
    }

    for (const dom of domainsRes.rows) {
      const s = schemaItemsMap.get(dom.schemaName)
      if (s) {
        s.domains = s.domains ?? []
        s.domains.push(dom.name)
      }
    }

    const schemas = Array.from(schemaItemsMap.values())
    const publicSchema = schemaItemsMap.get('public') ?? schemas[0]

    return {
      name: databaseName,
      charset: 'UTF8',
      schemas,
      tables: publicSchema ? publicSchema.tables : [],
      views: publicSchema ? publicSchema.views : [],
      materializedViews: publicSchema ? publicSchema.materializedViews : [],
      functions: publicSchema ? publicSchema.functions : [],
      procedures: publicSchema ? (publicSchema.procedures ?? []) : [],
      sequences: publicSchema ? (publicSchema.sequences ?? []) : [],
      extensions,
      types: publicSchema ? (publicSchema.types ?? []) : [],
      domains: publicSchema ? (publicSchema.domains ?? []) : [],
      foreignTables: publicSchema ? (publicSchema.foreignTables ?? []) : [],
      indexes: [],
      triggers: []
    }
  } finally {
    client.release()
  }
}

/**
 * 读取 PostgreSQL 数据库列表。
 * 若 light=true，仅返回库名和字符集，不深入查询每库的表/列等信息。
 */
export const readPostgreSqlDatabases = async (
  connection: AdapterConnection,
  options?: ReadDatabasesOptions
): Promise<DatabaseItem[]> => {
  const pool = getPostgresPool(connection)
  const client = await pool.connect()
  try {
    const result = await client.query<{ name: string }>(
      "SELECT datname AS name FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname"
    )
    if (options?.light) {
      const databases: DatabaseItem[] = []
      for (const row of result.rows) {
        try {
          const dbPool = getPostgresPool(connection, row.name)
          const dbClient = await dbPool.connect()
          try {
            const tables = await dbClient.query<{ name: string; comment: string }>(
              `SELECT c.relname AS name, COALESCE(obj_description(c.oid, 'pg_class'), '') AS comment
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`
            )
            databases.push({
              name: row.name,
              charset: 'UTF8',
              tables: tables.rows.map((t) => ({ name: t.name, comment: t.comment, columns: [], indexes: [], foreignKeys: [], checks: [], triggers: [] })),
              views: [],
              functions: [],
              procedures: [],
              indexes: [],
              triggers: [],
              materializedViews: [],
              sequences: []
            })
          } finally {
            dbClient.release()
          }
        } catch {
          databases.push({ name: row.name, charset: 'UTF8', tables: [], views: [], functions: [], procedures: [], indexes: [], triggers: [], materializedViews: [], sequences: [] })
        }
      }
      return databases
    }
    const databases: DatabaseItem[] = []
    for (const row of result.rows) {
      try {
        databases.push(await readPostgresDatabase(connection, row.name))
      } catch {
        databases.push({ name: row.name, charset: 'UTF8', tables: [], views: [], functions: [], procedures: [], indexes: [], triggers: [], materializedViews: [], sequences: [] })
      }
    }
    return databases
  } finally {
    client.release()
  }
}

/** 按需读取单个数据库的完整元数据 */
export const readPostgreSqlDatabaseDetail = async (
  connection: AdapterConnection,
  databaseName: string
): Promise<DatabaseItem> => {
  return readPostgresDatabase(connection, databaseName)
}

export const executePostgreSqlQuery = async (
  connection: AdapterConnection,
  databaseName: string,
  sql: string
): Promise<QueryExecutionResult> => {
  const poolKey = `${connection.host}:${connection.port}:${connection.username}`
  const workerConfig = { host: connection.host, port: connection.port, username: connection.username, password: connection.password, defaultDatabase: connection.defaultDatabase, sslEnabled: connection.sslEnabled, sslRejectUnauthorized: connection.sslRejectUnauthorized, sslCaPath: connection.sslCaPath, sslCertPath: connection.sslCertPath, sslKeyPath: connection.sslKeyPath }
  const startTime = new Date().toISOString()
  const startMs = performance.now()
  try {
    const isSelect = isSelectQuery(sql)
    const limitedSql = isSelect ? applyLimit(sql, QUERY_ROW_LIMIT) : sql
    const queryResult = await dbWorkerPgQuery(poolKey, workerConfig, databaseName, limitedSql)
    if (queryResult.type === 'rows') {
      const rows = queryResult.rows
      const fields = queryResult.fields
      const truncated = isSelect && rows.length >= QUERY_ROW_LIMIT
      let editable: QueryExecutionResult['editable']
      const tableIds = Array.from(new Set(fields.map((f) => f.tableID).filter(Boolean)))
      if (tableIds.length === 1) {
        const metaResult = await dbWorkerPgQuery(poolKey, workerConfig, databaseName,
          `SELECT c.relname AS "tableName", a.attnum AS "columnNumber", a.attname AS "columnName",
            EXISTS (
              SELECT 1 FROM pg_index i
              WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
            ) AS "primaryKey"
          FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
          WHERE c.oid = $1 AND a.attnum > 0 AND NOT a.attisdropped`,
          [tableIds[0]])
        if (metaResult.type === 'rows') {
          const metaRows = metaResult.rows as Array<{ tableName: string; columnNumber: number; columnName: string; primaryKey: boolean }>
          const primaryKeys = metaRows.filter((r) => r.primaryKey).map((r) => r.columnName)
          const metaByNumber = new Map(metaRows.map((r) => [r.columnNumber, r]))
          if (primaryKeys.length && primaryKeys.every((key) => fields.some((f) => f.columnID != null && metaByNumber.get(f.columnID)?.columnName === key))) {
            editable = {
              tableName: metaRows[0]?.tableName ?? '',
              primaryKeys,
              columns: fields.flatMap((field) => {
                const source = field.columnID != null ? metaByNumber.get(field.columnID) : undefined
                return source ? [{ resultName: field.name, sourceName: source.columnName, primaryKey: source.primaryKey }] : []
              })
            }
          }
        }
      }
      let cursorId: string | undefined
      if (truncated) {
        const cursor = createCursor({
          engine: 'PostgreSQL',
          connectionKey: `${connection.host}:${connection.port}/${databaseName}`,
          databaseName,
          sql,
          columns: fields.map((f) => f.name),
          editable,
          offset: rows.length,
          totalRows: rows.length
        })
        cursorId = cursor.id
      }
      const msg = truncated ? `查询成功，显示前 ${rows.length} 行` : `查询成功，共 ${rows.length} 行`
      return { success: true, message: msg, columns: fields.map((f) => f.name), rows, editable, startTime, endTime: new Date().toISOString(), durationMs: Math.round(performance.now() - startMs), queryCount: 1, successCount: 1, errorCount: 0, truncated, cursorId }
    }
    const affectedRows = queryResult.rowCount ?? 0
    return { success: true, message: `执行成功，影响 ${affectedRows} 行`, affectedRows, startTime, endTime: new Date().toISOString(), durationMs: Math.round(performance.now() - startMs), queryCount: 1, successCount: 1, errorCount: 0 }
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return { success: false, message: error instanceof Error ? error.message : '查询执行失败', startTime, endTime, durationMs, queryCount: 1, successCount: 0, errorCount: 1 }
  }
}

/** 通过游标获取更多 PostgreSQL 行 */
export const fetchMorePostgreSqlRows = async (
  connection: AdapterConnection,
  databaseName: string,
  cursor: QueryCursor,
  count: number = QUERY_ROW_LIMIT
): Promise<{ rows: Array<Record<string, unknown>>; done: boolean }> => {
  const poolKey = `${connection.host}:${connection.port}:${connection.username}`
  const workerConfig = { host: connection.host, port: connection.port, username: connection.username, password: connection.password, defaultDatabase: connection.defaultDatabase, sslEnabled: connection.sslEnabled, sslRejectUnauthorized: connection.sslRejectUnauthorized, sslCaPath: connection.sslCaPath, sslCertPath: connection.sslCertPath, sslKeyPath: connection.sslKeyPath }
  const limitedSql = applyLimitOffset(cursor.sql, count, cursor.offset)
  const queryResult = await dbWorkerPgQuery(poolKey, workerConfig, databaseName, limitedSql)
  const rows = queryResult.type === 'rows' ? queryResult.rows : []
  const done = rows.length < count
  updateCursorOffset(cursor.id, cursor.offset + rows.length)
  if (done) deleteCursor(cursor.id)
  return { rows, done }
}

export const readPostgreSqlTableData = async (
  connection: AdapterConnection,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  if (filter?.column) {
    const pool = getPostgresPool(connection, databaseName)
    const client = await pool.connect()
    try {
      const column = await client.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2",
        [tableName, filter.column]
      )
      if (!column.rowCount) return { success: false, message: '筛选字段不存在' }
    } finally {
      client.release()
    }
  }
  const where = filter?.column ? ` WHERE ${filterSql(filter)}` : ''
  const result = await executePostgreSqlQuery(connection, databaseName, `SELECT * FROM ${quotePg(tableName)}${where} LIMIT ${limit} OFFSET ${offset}`)
  return result.success && result.rows ? { ...result, message: `已加载 ${result.rows.length} 行数据` } : result
}

const postgresEditableColumns = async (client: Client | PoolClient, tableName: string): Promise<{ valid: Set<string>; primaryKeys: string[] }> => {
  const columns = await client.query<{ name: string; primaryKey: boolean }>(`
    SELECT a.attname AS name, EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
    ) AS "primaryKey"
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
  `, [tableName])
  return { valid: new Set(columns.rows.map((column) => column.name)), primaryKeys: columns.rows.filter((column) => column.primaryKey).map((column) => column.name) }
}

export const updatePostgreSqlRow = async (connection: AdapterConnection, input: QueryUpdateRowInput): Promise<ConnectionActionResult> => {
  const pool = getPostgresPool(connection, input.databaseName)
  const client = await pool.connect()
  try {
    const metadata = await postgresEditableColumns(client, input.tableName)
    const changes = Object.keys(input.changes)
    if (!metadata.valid.size) return { success: false, message: '数据表不存在或已被删除' }
    if (!metadata.primaryKeys.length || metadata.primaryKeys.some((key) => !(key in input.primaryKeyValues))) return { success: false, message: '查询结果缺少完整主键，无法安全保存' }
    if (changes.some((column) => !metadata.valid.has(column))) return { success: false, message: '包含无效字段，无法保存' }
    const values = [...changes.map((column) => input.changes[column]), ...metadata.primaryKeys.map((column) => input.primaryKeyValues[column])]
    const whereOffset = changes.length
    const result = await client.query(
      `UPDATE ${quotePg(input.tableName)} SET ${changes.map((column, index) => `${quotePg(column)} = $${index + 1}`).join(', ')} WHERE ${metadata.primaryKeys.map((column, index) => `${quotePg(column)} IS NOT DISTINCT FROM $${whereOffset + index + 1}`).join(' AND ')}`,
      values
    )
    return { success: true, message: result.rowCount ? '数据已保存' : '数据没有变化' }
  } finally {
    client.release()
  }
}

export const deletePostgreSqlRow = async (connection: AdapterConnection, input: QueryDeleteRowInput): Promise<ConnectionActionResult> => {
  const pool = getPostgresPool(connection, input.databaseName)
  const client = await pool.connect()
  try {
    const metadata = await postgresEditableColumns(client, input.tableName)
    if (!metadata.primaryKeys.length || metadata.primaryKeys.some((key) => !(key in input.primaryKeyValues))) return { success: false, message: '缺少完整主键，无法安全删除数据' }
    const result = await client.query(
      `DELETE FROM ${quotePg(input.tableName)} WHERE ${metadata.primaryKeys.map((column, index) => `${quotePg(column)} IS NOT DISTINCT FROM $${index + 1}`).join(' AND ')}`,
      metadata.primaryKeys.map((column) => input.primaryKeyValues[column])
    )
    return result.rowCount ? { success: true, message: '数据已删除' } : { success: false, message: '未找到该数据，可能已被修改或删除' }
  } finally {
    client.release()
  }
}

export const exportPostgreSqlTables = async (
  connection: AdapterConnection,
  databaseName: string,
  tableNames: string[],
  includeData: boolean,
  filePath: string,
  onProgress?: (progress: ExportSqlProgress) => void
): Promise<{ filePath: string; totalLength: number }> => {
  const pool = getPostgresPool(connection, databaseName)
  const client = await pool.connect()
  const stream = createWriteStream(filePath)
  let totalLength = 0
  const write = async (text: string): Promise<void> => {
    totalLength += Buffer.byteLength(text, 'utf8')
    await writeStreamChunk(stream, text)
  }

  try {
    await write(
      `-- QuillDB PostgreSQL export: ${databaseName}\n-- Generated at ${new Date().toISOString()}\n\nBEGIN;\n`
    )
    const foreignKeyStatements: string[] = []
    const total = tableNames.length
    for (let index = 0; index < total; index++) {
      const tableName = tableNames[index]
      onProgress?.({
        current: index + 1,
        total,
        tableName,
        message: `正在导出表 ${databaseName}.${tableName} (${index + 1}/${total})...`
      })
      const table = quotePg(tableName)
      const columns = await client.query<{ name: string; type: string; notNull: boolean; defaultValue: string | null; identity: string }>(`
        SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
          a.attnotnull AS "notNull", pg_get_expr(d.adbin, d.adrelid) AS "defaultValue", a.attidentity AS identity
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
      `, [tableName])
      const constraints = await client.query<{ name: string; definition: string; type: string }>(`
        SELECT con.conname AS name, pg_get_constraintdef(con.oid, true) AS definition, con.contype AS type
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1
        ORDER BY con.contype, con.conname
      `, [tableName])
      const definitions = columns.rows.map((column) => {
        const identity = column.identity === 'a'
          ? ' GENERATED ALWAYS AS IDENTITY'
          : column.identity === 'd' || column.defaultValue?.startsWith('nextval(')
            ? ' GENERATED BY DEFAULT AS IDENTITY'
            : column.defaultValue ? ` DEFAULT ${column.defaultValue}` : ''
        return `${quotePg(column.name)} ${column.type}${identity}${column.notNull ? ' NOT NULL' : ''}`
      })
      definitions.push(...constraints.rows.filter((constraint) => constraint.type !== 'f').map((constraint) =>
        `CONSTRAINT ${quotePg(constraint.name)} ${constraint.definition}`))
      foreignKeyStatements.push(...constraints.rows.filter((constraint) => constraint.type === 'f').map((constraint) =>
        `ALTER TABLE ${table} ADD CONSTRAINT ${quotePg(constraint.name)} ${constraint.definition};`))
      await write(`\nDROP TABLE IF EXISTS ${table} CASCADE;\nCREATE TABLE ${table} (\n  ${definitions.join(',\n  ')}\n);\n`)

      const indexes = await client.query<{ definition: string }>(`
        SELECT pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
        WHERE n.nspname = 'public' AND c.relname = $1 AND con.oid IS NULL
        ORDER BY i.indexrelid
      `, [tableName])
      if (indexes.rows.length) await write(`${indexes.rows.map((index) => `${index.definition};`).join('\n')}\n`)
      const comments = await client.query<{ columnName: string | null; comment: string }>(`
        SELECT NULL::text AS "columnName", obj_description(c.oid, 'pg_class') AS comment
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND obj_description(c.oid, 'pg_class') IS NOT NULL
        UNION ALL
        SELECT a.attname, col_description(c.oid, a.attnum)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND col_description(c.oid, a.attnum) IS NOT NULL
      `, [tableName])
      if (comments.rows.length) {
        await write(`${comments.rows.map((comment) =>
          `COMMENT ON ${comment.columnName ? `COLUMN ${table}.${quotePg(comment.columnName)}` : `TABLE ${table}`} IS ${postgresDumpValue(comment.comment)};`
        ).join('\n')}\n`)
      }

      if (includeData) {
        const pkResult = await client.query<{ attname: string }>(`
          SELECT a.attname FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary
        `, [tableName])
        const orderBy = pkResult.rows.length
          ? `ORDER BY ${pkResult.rows.map((r) => quotePg(r.attname)).join(', ')}`
          : 'ORDER BY ctid'
        const BATCH_SIZE = 5000
        let offset = 0
        let names: string[] = []
        while (true) {
          const rows = await client.query<Record<string, unknown>>(
            `SELECT * FROM ${table} ${orderBy} LIMIT ${BATCH_SIZE} OFFSET ${offset}`
          )
          if (!rows.rows.length) break
          if (!names.length) names.push(...rows.fields.map((field) => field.name))
          const insertPrefix = `INSERT INTO ${table} (${names.map(quotePg).join(', ')}) VALUES `
          const values = rows.rows.map((row) => `(${names.map((name) => postgresDumpValue(row[name])).join(', ')})`).join(';\n')
          await write(`${insertPrefix}${values};\n`)
          offset += BATCH_SIZE
        }
      }
    }
    if (foreignKeyStatements.length) await write(`\n-- Foreign keys\n${foreignKeyStatements.join('\n')}\n`)
    await write(`\nCOMMIT;\n`)
  } finally {
    await closeWriteStream(stream)
    client.release()
  }
  return { filePath, totalLength }
}

export const getPostgreSqlTableDefinition = async (connection: AdapterConnection, databaseName: string, tableName: string): Promise<TableDefinitionResult> => {
  const pool = getPostgresPool(connection, databaseName)
  const client = await pool.connect()
  try {
    const tableComment = await client.query<{ comment: string }>("SELECT COALESCE(obj_description(to_regclass($1), 'pg_class'), '') AS comment", [`public.${tableName}`])
    const columns = await client.query<{ name: string; dataType: string; maxLength: number | null; precision: number | null; scale: number | null; nullable: string; defaultValue: string | null; comment: string; primaryKey: boolean }>(`
      SELECT c.column_name AS name, c.data_type AS "dataType", c.character_maximum_length AS "maxLength",
        c.numeric_precision AS precision, c.numeric_scale AS scale, c.is_nullable AS nullable,
        c.column_default AS "defaultValue", COALESCE(d.description, '') AS comment,
        EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
          WHERE tc.table_schema = 'public' AND tc.table_name = c.table_name AND tc.constraint_type = 'PRIMARY KEY' AND kcu.column_name = c.column_name
        ) AS "primaryKey"
      FROM information_schema.columns c
      LEFT JOIN pg_catalog.pg_statio_all_tables st ON st.schemaname = c.table_schema AND st.relname = c.table_name
      LEFT JOIN pg_catalog.pg_description d ON d.objoid = st.relid AND d.objsubid = c.ordinal_position
      WHERE c.table_schema = 'public' AND c.table_name = $1 ORDER BY c.ordinal_position
    `, [tableName])
    if (!columns.rows.length) return { success: false, message: '数据表不存在或没有字段' }
    const indexesResult = await client.query<{ name: string; unique: boolean; definition: string }>(`
      SELECT i.relname AS name, x.indisunique AS unique, pg_get_indexdef(x.indexrelid) AS definition
      FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = $1 AND NOT x.indisprimary ORDER BY i.relname
    `, [tableName])
    const foreignKeysResult = await client.query<{ name: string; columnName: string; referencedTable: string; referencedColumn: string; onDelete: TableForeignKeyDefinition['onDelete']; onUpdate: TableForeignKeyDefinition['onUpdate'] }>(`
      SELECT tc.constraint_name AS name, kcu.column_name AS "columnName", ccu.table_name AS "referencedTable",
        ccu.column_name AS "referencedColumn", rc.delete_rule AS "onDelete", rc.update_rule AS "onUpdate"
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.table_schema = 'public' AND tc.table_name = $1 AND tc.constraint_type = 'FOREIGN KEY'
    `, [tableName])
    const indexes: TableIndexDefinition[] = indexesResult.rows.map((index) => ({
      name: index.name,
      type: index.unique ? 'UNIQUE' : 'INDEX',
      columns: Array.from(index.definition.matchAll(/"([^"]+)"/g)).map((match) => match[1]).filter((name) => name !== index.name && name !== tableName)
    }))
    return {
      success: true,
      message: '表结构读取成功',
      tableName,
      tableComment: tableComment.rows[0]?.comment ?? '',
      columns: columns.rows.map((column) => ({
        name: column.name,
        originalName: column.name,
        type: normalizedColumnType(column.dataType),
        typeDefinition: column.dataType,
        length: column.maxLength ? String(column.maxLength) : column.precision ? String(column.precision) : '',
        decimals: column.scale === null ? '' : String(column.scale),
        notNull: column.nullable === 'NO',
        primaryKey: column.primaryKey,
        comment: column.comment,
        defaultValue: column.defaultValue
      })),
      indexes,
      foreignKeys: foreignKeysResult.rows.map((foreignKey) => ({ ...foreignKey, column: foreignKey.columnName }))
    }
  } finally {
    client.release()
  }
}

export const updatePostgreSqlTableComment = async (connection: AdapterConnection, databaseName: string, tableName: string, comment: string): Promise<ConnectionActionResult> => {
  const pool = getPostgresPool(connection, databaseName)
  const client = await pool.connect()
  try {
    await client.query(`COMMENT ON TABLE ${quotePg(tableName)} IS ${comment ? quoteLiteral(comment) : 'NULL'}`)
    return { success: true, message: '表注释已保存' }
  } finally {
    client.release()
  }
}

export const executePostgreSqlFile = async (connection: AdapterConnection, databaseName: string | undefined, sql: string): Promise<void> => {
  const pool = getPostgresPool(connection, databaseName)
  const client = await pool.connect()
  try { await client.query(sql) } finally { client.release() }
}

/** 创建 PostgreSQL 可移植表（从 MySQL 迁移） */
export const createPostgreSqlPortableTable = async (
  connection: AdapterConnection,
  input: CreateTableInput
): Promise<ConnectionActionResult> => {
  const names = new Set<string>()
  for (const column of input.columns) {
    if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
    if (names.has(column.name)) return { success: false, message: `字段"${column.name}"重复` }
    names.add(column.name)
  }
  const definitions = input.columns.map((column) => portableColumn(column))
  const primaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => quotePg(column.name))
  if (primaryKeys.length) definitions.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
  for (const foreignKey of input.foreignKeys) {
    if (!names.has(foreignKey.column) || !foreignKey.referencedTable || !foreignKey.referencedColumn) return { success: false, message: `外键"${foreignKey.name || '未命名'}"设置不正确` }
    definitions.push(`CONSTRAINT ${quotePg(foreignKey.name)} FOREIGN KEY (${quotePg(foreignKey.column)}) REFERENCES ${quotePg(foreignKey.referencedTable)} (${quotePg(foreignKey.referencedColumn)}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`)
  }
  const table = quotePg(input.tableName)
  const statements = [`CREATE TABLE ${table} (${definitions.join(', ')})`]
  input.indexes.forEach((index) => {
    const unique = index.type === 'UNIQUE' ? 'UNIQUE ' : ''
    statements.push(`CREATE ${unique}INDEX ${quotePg(index.name)} ON ${table} (${index.columns.map(quotePg).join(', ')})`)
  })
  if (input.tableComment) {
    statements.push(`COMMENT ON TABLE ${table} IS ${quoteLiteral(input.tableComment)}`)
  }
  try {
    const pool = getPostgresPool(connection, input.databaseName)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const statement of statements) await client.query(statement)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    return { success: true, message: '数据表已创建' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '数据表创建失败' }
  }
}
