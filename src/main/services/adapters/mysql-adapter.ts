import { createPool } from 'mysql2/promise'
import type { Pool, RowDataPacket } from 'mysql2/promise'
import { createWriteStream } from 'node:fs'
import type {
  DatabaseCharset,
  DatabaseCharsetResult,
  ExportSqlProgress,
  MySQLColumnType,
  QueryExecutionResult,
  TableColumnDefinition
} from '@/shared/connections'
import type { StoredConnection } from '../../database/connection-repository'
import { buildSslConfig } from '../ssl-helper'
import { dbWorkerMysqlQuery, type DbWorkerFieldDetail } from '../db-query-runtime'

// ── MySQL connection pool cache ───────────────────────────────────────

const mysqlPools = new Map<string, Pool>()

const quoteId = (identifier: string): string => `\`${identifier.replaceAll('`', '``')}\``

const mysqlOptions = (connection: StoredConnection, database?: string, multipleStatements = false) => {
  return {
    host: connection.host,
    port: connection.port,
    user: connection.username,
    password: connection.password,
    database,
    connectTimeout: 5000,
    multipleStatements,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    ssl: buildSslConfig(connection)
  }
}

/** 获取（或懒创建）对应连接的 MySQL 连接池 */
export const getMysqlPool = (connection: StoredConnection, database?: string, multipleStatements = false): Pool => {
  const key = `${connection.id}:${database ?? ''}:${multipleStatements ? 'multi' : 'single'}`
  let pool = mysqlPools.get(key)
  if (!pool) {
    pool = createPool({
      ...mysqlOptions(connection, database, multipleStatements),
      connectionLimit: 5,
      idleTimeout: 60_000,
      waitForConnections: true
    })
    mysqlPools.set(key, pool)
  }
  return pool
}

/** 销毁属于指定连接 ID 的所有连接池 */
export const destroyMysqlPools = async (connectionId: number): Promise<void> => {
  const prefix = `${connectionId}:`
  const toDestroy: Promise<void>[] = []
  for (const [key, pool] of mysqlPools) {
    if (key.startsWith(prefix)) {
      mysqlPools.delete(key)
      toDestroy.push(pool.end().catch(() => undefined))
    }
  }
  await Promise.all(toDestroy)
}

// ── MySQL helper functions ────────────────────────────────────────────

const quoteString = (value: string): string => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`

const mysqlDumpValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return quoteString(text)
}

export const buildColumnDefinition = (column: TableColumnDefinition): string | null => {
  const supportedTypes = new Set<MySQLColumnType>([
    'CHAR', 'VARCHAR', 'BINARY', 'VARBINARY', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT',
    'DECIMAL', 'FLOAT', 'DOUBLE', 'BIT', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'DATETIME', 'TIMESTAMP', 'DATE', 'TIME',
    'YEAR', 'BOOLEAN', 'JSON', 'ENUM', 'SET'
  ])
  if (!supportedTypes.has(column.type)) return null
  let typeSql = column.typeDefinition
  if (!typeSql) {
    typeSql = column.type
    if (['CHAR', 'VARCHAR', 'BINARY', 'VARBINARY'].includes(column.type)) {
      if (!/^\d+$/.test(column.length) || Number(column.length) < 1 || Number(column.length) > 65535) return null
      typeSql += `(${column.length})`
    } else if (column.type === 'DECIMAL') {
      if (!/^\d{1,2}$/.test(column.length) || !/^\d{1,2}$/.test(column.decimals)) return null
      if (Number(column.decimals) > Number(column.length)) return null
      typeSql += `(${column.length},${column.decimals})`
    } else if (column.type === 'ENUM' || column.type === 'SET') return null
  }
  const parts = [
    quoteId(column.name),
    typeSql,
    column.notNull || column.primaryKey ? 'NOT NULL' : 'NULL'
  ]
  if (column.defaultValue !== undefined) {
    if (column.defaultValue === null) {
      if (!column.notNull && !column.primaryKey) parts.push('DEFAULT NULL')
    } else if (/^(CURRENT_TIMESTAMP(?:\(\d\))?|NULL)$/i.test(column.defaultValue)) {
      parts.push(`DEFAULT ${column.defaultValue}`)
    } else {
      parts.push(`DEFAULT ${quoteString(String(column.defaultValue))}`)
    }
  }
  if (column.autoIncrement || column.extra?.toLowerCase().includes('auto_increment')) parts.push('AUTO_INCREMENT')
  const onUpdate = column.extra?.match(/on update\s+(CURRENT_TIMESTAMP(?:\(\d\))?)/i)?.[1]
  if (onUpdate) parts.push(`ON UPDATE ${onUpdate}`)
  if (column.comment) parts.push(`COMMENT ${quoteString(column.comment)}`)
  return parts.join(' ')
}

export { quoteId as quoteMysqlIdentifier }

// ── MySQL query execution helpers ─────────────────────────────────────

/** Worker 版本的 MySQL 可编辑元数据提取 */
export const getMysqlEditableMetadata = async (
  workerConfig: { host: string; port: number; username: string; password: string; sslEnabled: boolean; sslRejectUnauthorized: boolean; sslCaPath: string; sslCertPath: string; sslKeyPath: string },
  databaseName: string,
  fields: DbWorkerFieldDetail[]
): Promise<QueryExecutionResult['editable']> => {
  const sourceTables = Array.from(new Set(fields.map((f) => f.orgTable ?? f.table ?? '').filter(Boolean)))
  if (sourceTables.length !== 1) return undefined
  const tableName = sourceTables[0]
  const poolKey = `${workerConfig.host}:${workerConfig.port}:${workerConfig.username}`
  const metaResult = await dbWorkerMysqlQuery(poolKey, workerConfig, databaseName,
    'SELECT COLUMN_NAME AS columnName, COLUMN_KEY AS columnKey FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
    [databaseName, tableName])
  if (metaResult.type !== 'rows') return undefined
  const columnRows = metaResult.rows as Array<{ columnName: string; columnKey: string }>
  const primaryKeys = columnRows.filter((c) => c.columnKey === 'PRI').map((c) => c.columnName)
  if (!primaryKeys.length || primaryKeys.some((key) => !fields.some((f) => (f.orgName ?? f.name) === key))) return undefined
  const validColumns = new Set(columnRows.map((c) => c.columnName))
  return {
    tableName,
    primaryKeys,
    columns: fields
      .filter((f) => (f.orgTable ?? f.table) === tableName && validColumns.has(f.orgName ?? f.name))
      .map((f) => ({
        resultName: f.name,
        sourceName: f.orgName ?? f.name,
        primaryKey: primaryKeys.includes(f.orgName ?? f.name)
      }))
  }
}

// ── MySQL charset / collation ─────────────────────────────────────────

interface CharsetRow extends RowDataPacket {
  name: string
  description: string
  defaultCollation: string
}

interface CollationRow extends RowDataPacket {
  charsetName: string
  collationName: string
}

export const listMysqlCharsets = async (connection: StoredConnection): Promise<DatabaseCharsetResult> => {
  const pool = getMysqlPool(connection)
  try {
    const [charsetRows] = await pool.query<CharsetRow[]>(`
      SELECT
        CHARACTER_SET_NAME AS name,
        DESCRIPTION AS description,
        DEFAULT_COLLATE_NAME AS defaultCollation
      FROM information_schema.CHARACTER_SETS
      ORDER BY CHARACTER_SET_NAME
    `)
    const [collationRows] = await pool.query<CollationRow[]>(`
      SELECT CHARACTER_SET_NAME AS charsetName, COLLATION_NAME AS collationName
      FROM information_schema.COLLATIONS
      ORDER BY CHARACTER_SET_NAME, COLLATION_NAME
    `)
    const collationsByCharset = new Map<string, string[]>()
    for (const row of collationRows) {
      const collations = collationsByCharset.get(row.charsetName) ?? []
      collations.push(row.collationName)
      collationsByCharset.set(row.charsetName, collations)
    }
    const charsets: DatabaseCharset[] = charsetRows.map((row) => ({
      name: row.name,
      description: row.description,
      defaultCollation: row.defaultCollation,
      collations: collationsByCharset.get(row.name) ?? [row.defaultCollation]
    }))
    return { success: true, message: '字符集读取成功', charsets }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '字符集读取失败' }
  }
}

// ── MySQL SQL export ──────────────────────────────────────────────────

export const exportMysqlTables = async (
  connection: StoredConnection,
  databaseName: string,
  tableNames: string[],
  includeData: boolean,
  filePath: string,
  onProgress?: (progress: ExportSqlProgress) => void
): Promise<{ filePath: string; totalLength: number }> => {
  const pool = getMysqlPool(connection, databaseName)
  const stream = createWriteStream(filePath)
  let totalLength = 0
  const write = async (text: string): Promise<void> => {
    totalLength += Buffer.byteLength(text, 'utf8')
    await new Promise<void>((resolve, reject) => {
      if (stream.write(text, 'utf8')) return resolve()
      stream.once('drain', resolve)
      stream.once('error', reject)
    })
  }
  const close = async (): Promise<void> => new Promise<void>((resolve, reject) => {
    stream.once('finish', resolve)
    stream.once('error', reject)
    stream.end()
  })

  try {
    await write(
      `-- QuillDB MySQL export: ${databaseName}\n-- Generated at ${new Date().toISOString()}\n\n` +
      `CREATE DATABASE IF NOT EXISTS ${quoteId(databaseName)};\n` +
      `USE ${quoteId(databaseName)};\n` +
      'SET FOREIGN_KEY_CHECKS=0;\n'
    )
    const total = tableNames.length
    for (let index = 0; index < total; index++) {
      const name = tableNames[index]
      onProgress?.({
        current: index + 1,
        total,
        tableName: name,
        message: `正在导出表 ${databaseName}.${name} (${index + 1}/${total})...`
      })
      const table = quoteId(name)
      const [createRows] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE ${table}`)
      const createSql = createRows[0]?.['Create Table']
      if (!createSql) continue
      await write(`\nDROP TABLE IF EXISTS ${table};\n${String(createSql)};\n`)
      if (includeData) {
        const [pkResult] = await pool.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
           ORDER BY ORDINAL_POSITION`,
          [databaseName, name]
        )
        const pkCols = pkResult.map((r) => String(r.COLUMN_NAME))
        const orderBy = pkCols.length
          ? `ORDER BY ${pkCols.map((c) => quoteId(c)).join(', ')}`
          : 'ORDER BY 1'
        const BATCH_SIZE = 5000
        let offset = 0
        let names: string[] = []
        while (true) {
          const [rows, fields] = await pool.query<RowDataPacket[]>(
            `SELECT * FROM ${table} ${orderBy} LIMIT ${BATCH_SIZE} OFFSET ${offset}`
          )
          if (!rows.length) break
          if (!names.length) names = fields.map((field) => field.name)
          const insertPrefix = `INSERT INTO ${table} (${names.map((col) => quoteId(col)).join(', ')}) VALUES `;
          for (const row of rows) {
            await write(`${insertPrefix}(${names.map((col) => mysqlDumpValue(row[col] as unknown)).join(', ')});\n`)
          }
          offset += BATCH_SIZE
        }
      }
    }
    await write('\nSET FOREIGN_KEY_CHECKS=1;\n')
  } finally {
    await close()
  }
  return { filePath, totalLength }
}
