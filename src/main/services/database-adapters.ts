import { basename } from 'node:path'
import { Client } from 'pg'
import { buildSslConfig, type SslConnectionConfig } from './ssl-helper'
import { DatabaseSync, type SqliteDatabase } from './sqlite-runtime'
import type {
  ConnectionActionResult,
  CreateTableInput,
  DatabaseItem,
  MySQLColumnType,
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput,
  TableColumnDefinition,
  TableDataFilter,
  TableDefinitionResult,
  TableForeignKeyDefinition,
  TableIndexDefinition,
  UpdateTableInput
} from '../../shared/connections'
import type { StoredConnection } from '../database/connection-repository'

export type AdapterConnection = Pick<StoredConnection, 'host' | 'port' | 'username' | 'password' | 'defaultDatabase'> &
  SslConnectionConfig

const quoteSqliteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`
const quotePostgresIdentifier = quoteSqliteIdentifier
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`
const sqliteCommentMarker = (comment: string): string => comment
  ? ` /* OmniDBTableComment:${Buffer.from(comment, 'utf8').toString('base64')} */`
  : ''

const portableType = (column: TableColumnDefinition, engine: 'PostgreSQL' | 'SQLite'): string => {
  if (engine === 'SQLite') {
    if (['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'YEAR', 'BOOLEAN', 'BIT'].includes(column.type)) return 'INTEGER'
    if (['DECIMAL'].includes(column.type)) return 'NUMERIC'
    if (['FLOAT', 'DOUBLE'].includes(column.type)) return 'REAL'
    if (['BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB'].includes(column.type)) return 'BLOB'
    return 'TEXT'
  }
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

const portableColumn = (column: TableColumnDefinition, engine: 'PostgreSQL' | 'SQLite'): string => {
  const parts = [quotePostgresIdentifier(column.name), portableType(column, engine)]
  if (column.notNull || column.primaryKey) parts.push('NOT NULL')
  if (column.defaultValue === null) parts.push('DEFAULT NULL')
  else if (column.defaultValue !== undefined && engine === 'SQLite') {
    parts.push(`DEFAULT ${column.defaultValue}`)
  } else if (column.defaultValue !== undefined) {
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

const extractSqliteChecks = (createSql: string): string[] => {
  const checks: string[] = []
  const pattern = /(?:CONSTRAINT\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z0-9_$]+)\s+)?CHECK\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(createSql))) {
    const opening = createSql.indexOf('(', match.index)
    let depth = 0
    let quote = ''
    for (let index = opening; index < createSql.length; index += 1) {
      const character = createSql[index]
      if (quote) {
        if (character === quote && createSql[index - 1] !== '\\') quote = ''
        continue
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character
        continue
      }
      if (character === '(') depth += 1
      if (character === ')') {
        depth -= 1
        if (depth === 0) {
          checks.push(createSql.slice(match.index, index + 1))
          pattern.lastIndex = index + 1
          break
        }
      }
    }
  }
  return checks
}

const replaceSqliteIdentifier = (sql: string, currentName: string, nextName: string): string => {
  const escaped = currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return sql.split(/('(?:''|[^'])*')/g).map((part) => {
    if (part.startsWith("'")) return part
    return part
      .replace(new RegExp(`"${escaped}"|\`${escaped}\`|\\[${escaped}\\]`, 'g'), quoteSqliteIdentifier(nextName))
      .replace(new RegExp(`\\b${escaped}\\b`, 'g'), nextName)
  }).join('')
}

const filterSql = (filter: TableDataFilter, dialect: 'PostgreSQL' | 'SQLite'): string => {
  const column = dialect === 'PostgreSQL' ? quotePostgresIdentifier(filter.column) : quoteSqliteIdentifier(filter.column)
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

const postgresClient = (connection: AdapterConnection, database?: string): Client => new Client({
  host: connection.host,
  port: connection.port,
  user: connection.username,
  password: connection.password,
  database: database || connection.defaultDatabase || 'postgres',
  connectionTimeoutMillis: 5000,
  ssl: buildSslConfig(connection)
})

const readPostgresDatabase = async (connection: AdapterConnection, databaseName: string): Promise<DatabaseItem> => {
  const client = postgresClient(connection, databaseName)
  await client.connect()
  try {
    // pg queues concurrent query calls today, but that behavior is deprecated in pg 9.
    // Keep one connected client and await every metadata query before issuing the next.
    const tables = await client.query<{ name: string; comment: string }>(`
        SELECT c.relname AS name, COALESCE(obj_description(c.oid, 'pg_class'), '') AS comment
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname
      `)
    const columns = await client.query<{ tableName: string; name: string }>(`SELECT table_name AS "tableName", column_name AS name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)
    const indexes = await client.query<{ tableName: string; name: string }>(`SELECT tablename AS "tableName", indexname AS name FROM pg_catalog.pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`)
    const constraints = await client.query<{ tableName: string; name: string; type: string }>(`SELECT tc.table_name AS "tableName", tc.constraint_name AS name, tc.constraint_type AS type FROM information_schema.table_constraints tc WHERE tc.table_schema = 'public' AND tc.constraint_type IN ('FOREIGN KEY', 'CHECK') ORDER BY tc.table_name, tc.constraint_name`)
    const triggers = await client.query<{ tableName: string; name: string }>(`SELECT event_object_table AS "tableName", trigger_name AS name FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY event_object_table, trigger_name`)
    const views = await client.query<{ name: string }>("SELECT table_name AS name FROM information_schema.views WHERE table_schema = 'public' ORDER BY table_name")
    const materializedViews = await client.query<{ name: string }>("SELECT matviewname AS name FROM pg_catalog.pg_matviews WHERE schemaname = 'public' ORDER BY matviewname")
    const functions = await client.query<{ name: string }>("SELECT routine_name AS name FROM information_schema.routines WHERE routine_schema = 'public' ORDER BY routine_name")
    const sequences = await client.query<{ name: string }>("SELECT sequence_name AS name FROM information_schema.sequences WHERE sequence_schema = 'public' ORDER BY sequence_name")
    const columnsByTable = groupBy(columns.rows, (row) => row.tableName, (row) => row.name)
    const indexesByTable = groupBy(indexes.rows, (row) => row.tableName, (row) => row.name)
    const foreignKeysByTable = groupBy(constraints.rows.filter((row) => row.type === 'FOREIGN KEY'), (row) => row.tableName, (row) => row.name)
    const checksByTable = groupBy(constraints.rows.filter((row) => row.type === 'CHECK'), (row) => row.tableName, (row) => row.name)
    const triggersByTable = groupBy(triggers.rows, (row) => row.tableName, (row) => row.name)
    return {
      name: databaseName,
      charset: 'UTF8',
      tables: tables.rows.map((table) => ({
        name: table.name,
        comment: table.comment,
        columns: columnsByTable.get(table.name) ?? [],
        indexes: indexesByTable.get(table.name) ?? [],
        foreignKeys: foreignKeysByTable.get(table.name) ?? [],
        checks: checksByTable.get(table.name) ?? [],
        triggers: triggersByTable.get(table.name) ?? []
      })),
      views: views.rows.map((row) => row.name),
      materializedViews: materializedViews.rows.map((row) => row.name),
      functions: functions.rows.map((row) => row.name),
      procedures: [],
      sequences: sequences.rows.map((row) => row.name),
      indexes: [],
      triggers: []
    }
  } finally {
    await client.end()
  }
}

export const readPostgreSqlDatabases = async (connection: AdapterConnection): Promise<DatabaseItem[]> => {
  const client = postgresClient(connection)
  await client.connect()
  try {
    const result = await client.query<{ name: string }>("SELECT datname AS name FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname")
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
    await client.end()
  }
}

export const executePostgreSqlQuery = async (
  connection: AdapterConnection,
  databaseName: string,
  sql: string
): Promise<QueryExecutionResult> => {
  const client = postgresClient(connection, databaseName)
  const startTime = new Date().toISOString()
  const startMs = performance.now()
  await client.connect()
  try {
    const result = await client.query(sql)
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    if (result.fields.length) {
      const rows = result.rows.map((row) => ({ ...row }))
      const tableIds = Array.from(new Set(result.fields.map((field) => field.tableID).filter(Boolean)))
      let editable: QueryExecutionResult['editable']
      if (tableIds.length === 1) {
        const metadata = await client.query<{ tableName: string; columnNumber: number; columnName: string; primaryKey: boolean }>(`
          SELECT c.relname AS "tableName", a.attnum AS "columnNumber", a.attname AS "columnName",
            EXISTS (
              SELECT 1 FROM pg_index i
              WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
            ) AS "primaryKey"
          FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
          WHERE c.oid = $1 AND a.attnum > 0 AND NOT a.attisdropped
        `, [tableIds[0]])
        const primaryKeys = metadata.rows.filter((row) => row.primaryKey).map((row) => row.columnName)
        const metadataByNumber = new Map(metadata.rows.map((row) => [row.columnNumber, row]))
        if (primaryKeys.length && primaryKeys.every((key) => result.fields.some((field) => metadataByNumber.get(field.columnID)?.columnName === key))) {
          editable = {
            tableName: metadata.rows[0]?.tableName ?? '',
            primaryKeys,
            columns: result.fields.flatMap((field) => {
              const source = metadataByNumber.get(field.columnID)
              return source ? [{ resultName: field.name, sourceName: source.columnName, primaryKey: source.primaryKey }] : []
            })
          }
        }
      }
      return { success: true, message: `查询成功，共 ${rows.length} 行`, columns: result.fields.map((field) => field.name), rows, editable, startTime, endTime, durationMs, queryCount: 1, successCount: 1, errorCount: 0 }
    }
    return { success: true, message: `执行成功，影响 ${result.rowCount ?? 0} 行`, affectedRows: result.rowCount ?? 0, startTime, endTime, durationMs, queryCount: 1, successCount: 1, errorCount: 0 }
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return { success: false, message: error instanceof Error ? error.message : '查询执行失败', startTime, endTime, durationMs, queryCount: 1, successCount: 0, errorCount: 1 }
  } finally {
    await client.end()
  }
}

export const readPostgreSqlTableData = async (
  connection: AdapterConnection,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  const client = postgresClient(connection, databaseName)
  await client.connect()
  try {
    if (filter?.column) {
      const column = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2", [tableName, filter.column])
      if (!column.rowCount) return { success: false, message: '筛选字段不存在' }
    }
  } finally {
    await client.end()
  }
  const where = filter?.column ? ` WHERE ${filterSql(filter, 'PostgreSQL')}` : ''
  const result = await executePostgreSqlQuery(connection, databaseName, `SELECT * FROM ${quotePostgresIdentifier(tableName)}${where} LIMIT ${limit} OFFSET ${offset}`)
  return result.success && result.rows ? { ...result, message: `已加载 ${result.rows.length} 行数据` } : result
}

const postgresEditableColumns = async (client: Client, tableName: string): Promise<{ valid: Set<string>; primaryKeys: string[] }> => {
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
  const client = postgresClient(connection, input.databaseName)
  await client.connect()
  try {
    const metadata = await postgresEditableColumns(client, input.tableName)
    const changes = Object.keys(input.changes)
    if (!metadata.valid.size) return { success: false, message: '数据表不存在或已被删除' }
    if (!metadata.primaryKeys.length || metadata.primaryKeys.some((key) => !(key in input.primaryKeyValues))) return { success: false, message: '查询结果缺少完整主键，无法安全保存' }
    if (changes.some((column) => !metadata.valid.has(column))) return { success: false, message: '包含无效字段，无法保存' }
    const values = [...changes.map((column) => input.changes[column]), ...metadata.primaryKeys.map((column) => input.primaryKeyValues[column])]
    const whereOffset = changes.length
    const result = await client.query(
      `UPDATE ${quotePostgresIdentifier(input.tableName)} SET ${changes.map((column, index) => `${quotePostgresIdentifier(column)} = $${index + 1}`).join(', ')} WHERE ${metadata.primaryKeys.map((column, index) => `${quotePostgresIdentifier(column)} IS NOT DISTINCT FROM $${whereOffset + index + 1}`).join(' AND ')}`,
      values
    )
    return { success: true, message: result.rowCount ? '数据已保存' : '数据没有变化' }
  } finally {
    await client.end()
  }
}

export const deletePostgreSqlRow = async (connection: AdapterConnection, input: QueryDeleteRowInput): Promise<ConnectionActionResult> => {
  const client = postgresClient(connection, input.databaseName)
  await client.connect()
  try {
    const metadata = await postgresEditableColumns(client, input.tableName)
    if (!metadata.primaryKeys.length || metadata.primaryKeys.some((key) => !(key in input.primaryKeyValues))) return { success: false, message: '缺少完整主键，无法安全删除数据' }
    const result = await client.query(
      `DELETE FROM ${quotePostgresIdentifier(input.tableName)} WHERE ${metadata.primaryKeys.map((column, index) => `${quotePostgresIdentifier(column)} IS NOT DISTINCT FROM $${index + 1}`).join(' AND ')}`,
      metadata.primaryKeys.map((column) => input.primaryKeyValues[column])
    )
    return result.rowCount ? { success: true, message: '数据已删除' } : { success: false, message: '未找到该数据，可能已被修改或删除' }
  } finally {
    await client.end()
  }
}

export const readSqliteDatabases = (connection: AdapterConnection): DatabaseItem[] => {
  const database = new DatabaseSync(connection.host)
  try {
    database.exec('PRAGMA foreign_keys = ON')
    const objects = database.prepare("SELECT name, type, sql, tbl_name AS tableName FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as unknown as Array<{ name: string; type: string; sql: string | null; tableName: string }>
    const tableRows = objects.filter((object) => object.type === 'table')
    const tables = tableRows.map((table) => {
      const columns = database.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(table.name)})`).all() as unknown as Array<{ name: string }>
      const indexes = database.prepare(`PRAGMA index_list(${quoteSqliteIdentifier(table.name)})`).all() as unknown as Array<{ name: string }>
      const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${quoteSqliteIdentifier(table.name)})`).all() as unknown as Array<{ id: number; table: string }>
      const checks = Array.from(table.sql?.matchAll(/(?:CONSTRAINT\s+["`\[]?([^\s"`\]]+)["`\]]?\s+)?CHECK\s*\(/gi) ?? []).map((match, index) => match[1] || `CHECK_${index + 1}`)
      return {
        name: table.name,
        comment: (() => {
          const encoded = table.sql?.match(/\/\*\s*OmniDBTableComment:([A-Za-z0-9+/=]+)\s*\*\//)?.[1]
          return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : ''
        })(),
        columns: columns.map((column) => column.name),
        indexes: indexes.map((index) => index.name),
        foreignKeys: foreignKeys.map((foreignKey) => `FK_${foreignKey.id} → ${foreignKey.table}`),
        checks,
        triggers: objects.filter((object) => object.type === 'trigger' && object.tableName === table.name).map((object) => object.name)
      }
    })
    return [{
      name: basename(connection.host),
      tables,
      views: objects.filter((object) => object.type === 'view').map((object) => object.name),
      functions: [],
      procedures: [],
      indexes: objects.filter((object) => object.type === 'index').map((object) => object.name),
      triggers: objects.filter((object) => object.type === 'trigger').map((object) => object.name)
    }]
  } finally {
    database.close()
  }
}

const postgresDumpValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (Buffer.isBuffer(value)) return `decode('${value.toString('hex')}', 'hex')`
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `'${text.replaceAll("'", "''")}'`
}

export const exportPostgreSqlTables = async (
  connection: AdapterConnection,
  databaseName: string,
  tableNames: string[],
  includeData: boolean
): Promise<string> => {
  const client = postgresClient(connection, databaseName)
  await client.connect()
  try {
    const statements = [
      `-- OrbiSQL PostgreSQL export: ${databaseName}`,
      `-- Generated at ${new Date().toISOString()}`,
      '',
      'BEGIN;'
    ]
    const foreignKeyStatements: string[] = []
    for (const tableName of tableNames) {
      const table = quotePostgresIdentifier(tableName)
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
        return `${quotePostgresIdentifier(column.name)} ${column.type}${identity}${column.notNull ? ' NOT NULL' : ''}`
      })
      definitions.push(...constraints.rows.filter((constraint) => constraint.type !== 'f').map((constraint) =>
        `CONSTRAINT ${quotePostgresIdentifier(constraint.name)} ${constraint.definition}`))
      foreignKeyStatements.push(...constraints.rows.filter((constraint) => constraint.type === 'f').map((constraint) =>
        `ALTER TABLE ${table} ADD CONSTRAINT ${quotePostgresIdentifier(constraint.name)} ${constraint.definition};`))
      statements.push('', `DROP TABLE IF EXISTS ${table} CASCADE;`, `CREATE TABLE ${table} (\n  ${definitions.join(',\n  ')}\n);`)

      const indexes = await client.query<{ definition: string }>(`
        SELECT pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
        WHERE n.nspname = 'public' AND c.relname = $1 AND con.oid IS NULL
        ORDER BY i.indexrelid
      `, [tableName])
      statements.push(...indexes.rows.map((index) => `${index.definition};`))
      const comments = await client.query<{ columnName: string | null; comment: string }>(`
        SELECT NULL::text AS "columnName", obj_description(c.oid, 'pg_class') AS comment
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1 AND obj_description(c.oid, 'pg_class') IS NOT NULL
        UNION ALL
        SELECT a.attname, col_description(c.oid, a.attnum)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND col_description(c.oid, a.attnum) IS NOT NULL
      `, [tableName])
      comments.rows.forEach((comment) => statements.push(
        `COMMENT ON ${comment.columnName ? `COLUMN ${table}.${quotePostgresIdentifier(comment.columnName)}` : `TABLE ${table}`} IS ${postgresDumpValue(comment.comment)};`
      ))

      if (includeData) {
        const rows = await client.query<Record<string, unknown>>(`SELECT * FROM ${table}`)
        const names = rows.fields.map((field) => field.name)
        for (const row of rows.rows) {
          statements.push(`INSERT INTO ${table} (${names.map(quotePostgresIdentifier).join(', ')}) VALUES (${names.map((name) => postgresDumpValue(row[name])).join(', ')});`)
        }
      }
    }
    if (foreignKeyStatements.length) statements.push('', '-- Foreign keys', ...foreignKeyStatements)
    statements.push('', 'COMMIT;', '')
    return statements.join('\n')
  } finally {
    await client.end()
  }
}

const sqliteDumpValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
  return `'${String(value).replaceAll("'", "''")}'`
}

export const exportSqliteTables = (
  connection: AdapterConnection,
  tableNames: string[],
  includeData: boolean
): string => {
  const database = new DatabaseSync(connection.host)
  try {
    const statements = [
      `-- OrbiSQL SQLite export: ${basename(connection.host)}`,
      `-- Generated at ${new Date().toISOString()}`,
      '',
      'PRAGMA foreign_keys=OFF;',
      'BEGIN TRANSACTION;'
    ]
    for (const tableName of tableNames) {
      const table = quoteSqliteIdentifier(tableName)
      const schema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { sql?: string } | undefined
      if (!schema?.sql) continue
      statements.push('', `DROP TABLE IF EXISTS ${table};`, `${schema.sql};`)
      const objects = database.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name").all(tableName) as unknown as Array<{ sql: string }>
      statements.push(...objects.map((object) => `${object.sql};`))
      if (includeData) {
        const rows = database.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
        for (const row of rows) {
          const names = Object.keys(row)
          statements.push(`INSERT INTO ${table} (${names.map(quoteSqliteIdentifier).join(', ')}) VALUES (${names.map((name) => sqliteDumpValue(row[name])).join(', ')});`)
        }
      }
    }
    statements.push('', 'COMMIT;', 'PRAGMA foreign_keys=ON;', '')
    return statements.join('\n')
  } finally {
    database.close()
  }
}

export const executeSqliteQuery = (connection: AdapterConnection, sql: string): QueryExecutionResult => {
  const database = new DatabaseSync(connection.host)
  const startTime = new Date().toISOString()
  const startMs = performance.now()
  try {
    database.exec('PRAGMA foreign_keys = ON')
    const statement = database.prepare(sql)
    const columns = statement.columns().map((column) => column.name)
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    if (columns.length) {
      const rows = statement.all().map((row) => ({ ...(row as Record<string, unknown>) }))
      let editable: QueryExecutionResult['editable']
      const tableName = sql.match(/\bFROM\s+["`\[]?([A-Za-z0-9_$]+)["`\]]?/i)?.[1]
      if (tableName) {
        const tableColumns = database.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all() as unknown as Array<{ name: string; pk: number }>
        const primaryKeys = tableColumns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name)
        if (primaryKeys.length && primaryKeys.every((key) => columns.includes(key))) {
          const validColumns = new Set(tableColumns.map((column) => column.name))
          editable = {
            tableName,
            primaryKeys,
            columns: columns.filter((column) => validColumns.has(column)).map((column) => ({ resultName: column, sourceName: column, primaryKey: primaryKeys.includes(column) }))
          }
        }
      }
      return { success: true, message: `查询成功，共 ${rows.length} 行`, columns, rows, editable, startTime, endTime, durationMs, queryCount: 1, successCount: 1, errorCount: 0 }
    }
    const result = statement.run()
    return { success: true, message: `执行成功，影响 ${result.changes} 行`, affectedRows: Number(result.changes), startTime, endTime, durationMs, queryCount: 1, successCount: 1, errorCount: 0 }
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return { success: false, message: error instanceof Error ? error.message : '查询执行失败', startTime, endTime, durationMs, queryCount: 1, successCount: 0, errorCount: 1 }
  } finally {
    database.close()
  }
}

export const readSqliteTableData = (
  connection: AdapterConnection,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): QueryExecutionResult => {
  const database = new DatabaseSync(connection.host)
  try {
    if (filter?.column) {
      const columns = database.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all() as unknown as Array<{ name: string }>
      if (!columns.some((column) => column.name === filter.column)) return { success: false, message: '筛选字段不存在' }
    }
  } finally {
    database.close()
  }
  const where = filter?.column ? ` WHERE ${filterSql(filter, 'SQLite')}` : ''
  const result = executeSqliteQuery(connection, `SELECT * FROM ${quoteSqliteIdentifier(tableName)}${where} LIMIT ${limit} OFFSET ${offset}`)
  return result.success && result.rows ? { ...result, message: `已加载 ${result.rows.length} 行数据` } : result
}

const sqliteEditableColumns = (database: SqliteDatabase, tableName: string): { valid: Set<string>; primaryKeys: string[] } => {
  const columns = database.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all() as unknown as Array<{ name: string; pk: number }>
  return {
    valid: new Set(columns.map((column) => column.name)),
    primaryKeys: columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name)
  }
}

export const updateSqliteRow = (connection: AdapterConnection, input: QueryUpdateRowInput): ConnectionActionResult => {
  const database = new DatabaseSync(connection.host)
  try {
    const metadata = sqliteEditableColumns(database, input.tableName)
    const changes = Object.keys(input.changes)
    if (!metadata.primaryKeys.length || metadata.primaryKeys.some((key) => !(key in input.primaryKeyValues))) return { success: false, message: '查询结果缺少完整主键，无法安全保存' }
    if (changes.some((column) => !metadata.valid.has(column))) return { success: false, message: '包含无效字段，无法保存' }
    const result = database.prepare(`UPDATE ${quoteSqliteIdentifier(input.tableName)} SET ${changes.map((column) => `${quoteSqliteIdentifier(column)} = ?`).join(', ')} WHERE ${metadata.primaryKeys.map((column) => `${quoteSqliteIdentifier(column)} IS ?`).join(' AND ')}`).run(...changes.map((column) => input.changes[column] as never), ...metadata.primaryKeys.map((column) => input.primaryKeyValues[column] as never))
    return { success: true, message: result.changes ? '数据已保存' : '数据没有变化' }
  } finally {
    database.close()
  }
}

export const deleteSqliteRow = (connection: AdapterConnection, input: QueryDeleteRowInput): ConnectionActionResult => {
  const database = new DatabaseSync(connection.host)
  try {
    const metadata = sqliteEditableColumns(database, input.tableName)
    if (!metadata.primaryKeys.length || metadata.primaryKeys.some((key) => !(key in input.primaryKeyValues))) return { success: false, message: '缺少完整主键，无法安全删除数据' }
    const result = database.prepare(`DELETE FROM ${quoteSqliteIdentifier(input.tableName)} WHERE ${metadata.primaryKeys.map((column) => `${quoteSqliteIdentifier(column)} IS ?`).join(' AND ')}`).run(...metadata.primaryKeys.map((column) => input.primaryKeyValues[column] as never))
    return result.changes ? { success: true, message: '数据已删除' } : { success: false, message: '未找到该数据，可能已被修改或删除' }
  } finally {
    database.close()
  }
}

export const createPortableTable = async (
  connection: AdapterConnection,
  engine: 'PostgreSQL' | 'SQLite',
  input: CreateTableInput
): Promise<ConnectionActionResult> => {
  const names = new Set<string>()
  for (const column of input.columns) {
    if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
    if (names.has(column.name)) return { success: false, message: `字段“${column.name}”重复` }
    names.add(column.name)
  }
  const definitions = input.columns.map((column) => portableColumn(column, engine))
  const primaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => quotePostgresIdentifier(column.name))
  if (primaryKeys.length) definitions.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
  for (const foreignKey of input.foreignKeys) {
    if (!names.has(foreignKey.column) || !foreignKey.referencedTable || !foreignKey.referencedColumn) return { success: false, message: `外键“${foreignKey.name || '未命名'}”设置不正确` }
    definitions.push(`CONSTRAINT ${quotePostgresIdentifier(foreignKey.name)} FOREIGN KEY (${quotePostgresIdentifier(foreignKey.column)}) REFERENCES ${quotePostgresIdentifier(foreignKey.referencedTable)} (${quotePostgresIdentifier(foreignKey.referencedColumn)}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`)
  }
  const table = quotePostgresIdentifier(input.tableName)
  const statements = [`CREATE TABLE ${table}${engine === 'SQLite' ? sqliteCommentMarker(input.tableComment) : ''} (${definitions.join(', ')})`]
  input.indexes.forEach((index) => {
    const unique = index.type === 'UNIQUE' ? 'UNIQUE ' : ''
    statements.push(`CREATE ${unique}INDEX ${quotePostgresIdentifier(index.name)} ON ${table} (${index.columns.map(quotePostgresIdentifier).join(', ')})`)
  })
  if (engine === 'PostgreSQL' && input.tableComment) {
    statements.push(`COMMENT ON TABLE ${table} IS ${quoteLiteral(input.tableComment)}`)
  }
  try {
    if (engine === 'PostgreSQL') {
      const client = postgresClient(connection, input.databaseName)
      await client.connect()
      try {
        await client.query('BEGIN')
        for (const statement of statements) await client.query(statement)
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        await client.end()
      }
    } else {
      const database = new DatabaseSync(connection.host)
      try {
        database.exec('PRAGMA foreign_keys = ON')
        database.exec('BEGIN')
        for (const statement of statements) database.exec(statement)
        database.exec('COMMIT')
      } catch (error) {
        try { database.exec('ROLLBACK') } catch { /* 保留原始错误 */ }
        throw error
      } finally {
        database.close()
      }
    }
    return { success: true, message: '数据表已创建' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '数据表创建失败' }
  }
}

export const getPostgreSqlTableDefinition = async (connection: AdapterConnection, databaseName: string, tableName: string): Promise<TableDefinitionResult> => {
  const client = postgresClient(connection, databaseName)
  await client.connect()
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
    await client.end()
  }
}

export const updatePostgreSqlTableComment = async (connection: AdapterConnection, databaseName: string, tableName: string, comment: string): Promise<ConnectionActionResult> => {
  const client = postgresClient(connection, databaseName)
  await client.connect()
  try {
    await client.query(`COMMENT ON TABLE ${quotePostgresIdentifier(tableName)} IS ${comment ? quoteLiteral(comment) : 'NULL'}`)
    return { success: true, message: '表注释已保存' }
  } finally {
    await client.end()
  }
}

export const getSqliteTableDefinition = (connection: AdapterConnection, tableName: string): TableDefinitionResult => {
  const database = new DatabaseSync(connection.host)
  try {
    const tableSql = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { sql?: string } | undefined
    const encodedComment = tableSql?.sql?.match(/\/\*\s*OmniDBTableComment:([A-Za-z0-9+/=]+)\s*\*\//)?.[1]
    const columns = database.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all() as unknown as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>
    if (!columns.length) return { success: false, message: '数据表不存在或没有字段' }
    const indexRows = database.prepare(`PRAGMA index_list(${quoteSqliteIdentifier(tableName)})`).all() as unknown as Array<{ name: string; unique: number; origin: string }>
    const indexes: TableIndexDefinition[] = indexRows.filter((index) => index.origin !== 'pk').map((index) => ({
      name: index.name,
      type: index.unique ? 'UNIQUE' : 'INDEX',
      columns: (database.prepare(`PRAGMA index_info(${quoteSqliteIdentifier(index.name)})`).all() as unknown as Array<{ name: string }>).map((column) => column.name)
    }))
    const foreignKeyRows = database.prepare(`PRAGMA foreign_key_list(${quoteSqliteIdentifier(tableName)})`).all() as unknown as Array<{ id: number; from: string; table: string; to: string; on_delete: TableForeignKeyDefinition['onDelete']; on_update: TableForeignKeyDefinition['onUpdate'] }>
    return {
      success: true,
      message: '表结构读取成功',
      tableName,
      tableComment: encodedComment ? Buffer.from(encodedComment, 'base64').toString('utf8') : '',
      columns: columns.map((column) => ({
        name: column.name,
        originalName: column.name,
        type: normalizedColumnType(column.type),
        typeDefinition: column.type || 'TEXT',
        length: column.type.match(/\((\d+)/)?.[1] ?? '',
        decimals: column.type.match(/\(\d+\s*,\s*(\d+)/)?.[1] ?? '',
        notNull: Boolean(column.notnull),
        primaryKey: column.pk > 0,
        comment: '',
        defaultValue: column.dflt_value
      })),
      indexes,
      foreignKeys: foreignKeyRows.map((foreignKey) => ({
        name: `FK_${foreignKey.id}`,
        column: foreignKey.from,
        referencedTable: foreignKey.table,
        referencedColumn: foreignKey.to,
        onDelete: foreignKey.on_delete,
        onUpdate: foreignKey.on_update
      }))
    }
  } finally {
    database.close()
  }
}

export const updateSqliteTable = (connection: AdapterConnection, input: UpdateTableInput): ConnectionActionResult => {
  const database = new DatabaseSync(connection.host)
  const temporaryName = `__omnidb_edit_${Date.now()}`
  try {
    database.exec('PRAGMA foreign_keys = ON')
    const original = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(input.currentTableName) as { sql: string } | undefined
    if (!original?.sql) return { success: false, message: '数据表不存在或已被删除' }
    const triggers = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name").all(input.currentTableName) as unknown as Array<{ sql: string }>

    const columnNames = new Set<string>()
    for (const column of input.columns) {
      if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
      if (columnNames.has(column.name)) return { success: false, message: `字段“${column.name}”重复` }
      columnNames.add(column.name)
    }
    for (const index of input.indexes) {
      if (!index.name.trim() || !index.columns.length || index.columns.some((column) => !columnNames.has(column))) {
        return { success: false, message: `索引“${index.name || '未命名'}”设置不正确` }
      }
    }

    const definitions = input.columns.map((column) => portableColumn(column, 'SQLite'))
    const primaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => quoteSqliteIdentifier(column.name))
    if (primaryKeys.length) definitions.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
    for (const foreignKey of input.foreignKeys) {
      if (!foreignKey.name || !columnNames.has(foreignKey.column) || !foreignKey.referencedTable || !foreignKey.referencedColumn) {
        return { success: false, message: `外键“${foreignKey.name || '未命名'}”设置不正确` }
      }
      definitions.push(`CONSTRAINT ${quoteSqliteIdentifier(foreignKey.name)} FOREIGN KEY (${quoteSqliteIdentifier(foreignKey.column)}) REFERENCES ${quoteSqliteIdentifier(foreignKey.referencedTable)} (${quoteSqliteIdentifier(foreignKey.referencedColumn)}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`)
    }
    const renamedColumns = input.columns.filter((column) => column.originalName && column.originalName !== column.name)
    const checks = extractSqliteChecks(original.sql).map((check) => renamedColumns.reduce(
      (sql, column) => replaceSqliteIdentifier(sql, column.originalName ?? column.name, column.name),
      check
    ))
    definitions.push(...checks)

    const retainedColumns = input.columns.filter((column) => column.originalName)
    const destinationColumns = retainedColumns.map((column) => quoteSqliteIdentifier(column.name)).join(', ')
    const sourceColumns = retainedColumns.map((column) => quoteSqliteIdentifier(column.originalName ?? column.name)).join(', ')
    const oldTable = quoteSqliteIdentifier(input.currentTableName)
    const temporaryTable = quoteSqliteIdentifier(temporaryName)
    const targetTable = quoteSqliteIdentifier(input.tableName)

    database.exec('PRAGMA foreign_keys = OFF')
    database.exec('BEGIN IMMEDIATE')
    try {
      database.exec(`CREATE TABLE ${temporaryTable}${sqliteCommentMarker(input.tableComment)} (${definitions.join(', ')})`)
      if (retainedColumns.length) database.exec(`INSERT INTO ${temporaryTable} (${destinationColumns}) SELECT ${sourceColumns} FROM ${oldTable}`)
      database.exec(`DROP TABLE ${oldTable}`)
      database.exec(`ALTER TABLE ${temporaryTable} RENAME TO ${targetTable}`)
      input.indexes.forEach((index) => {
        database.exec(`CREATE ${index.type === 'UNIQUE' ? 'UNIQUE ' : ''}INDEX ${quoteSqliteIdentifier(index.name)} ON ${targetTable} (${index.columns.map(quoteSqliteIdentifier).join(', ')})`)
      })
      triggers.forEach((trigger) => {
        let triggerSql = renamedColumns.reduce(
          (sql, column) => replaceSqliteIdentifier(sql, column.originalName ?? column.name, column.name),
          trigger.sql
        )
        if (input.tableName !== input.currentTableName) {
          const escapedName = input.currentTableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          triggerSql = triggerSql.replace(
            new RegExp(`(\\bON\\s+)(?:"${escapedName}"|\`${escapedName}\`|\\[${escapedName}\\]|${escapedName})(\\s+)`, 'i'),
            `$1${targetTable}$2`
          )
        }
        database.exec(triggerSql)
      })
      if (database.prepare('PRAGMA foreign_key_check').get()) {
        throw new Error('现有数据违反新的外键约束，已取消本次表结构修改')
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    } finally {
      database.exec('PRAGMA foreign_keys = ON')
    }
    return { success: true, message: 'SQLite 表结构已保存' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'SQLite 表结构保存失败' }
  } finally {
    database.close()
  }
}

export const executePostgreSqlFile = async (connection: AdapterConnection, databaseName: string | undefined, sql: string): Promise<void> => {
  const client = postgresClient(connection, databaseName)
  await client.connect()
  try { await client.query(sql) } finally { await client.end() }
}

export const executeSqliteFile = (connection: AdapterConnection, sql: string): void => {
  const database = new DatabaseSync(connection.host)
  try { database.exec('PRAGMA foreign_keys = ON'); database.exec(sql) } finally { database.close() }
}
