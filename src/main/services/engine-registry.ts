/**
 * 引擎注册表（优化方案 P0-2）
 *
 * 所有数据库引擎的运行时能力统一登记于此：
 * - ConnectionService 只做路由，不再在各入口维护引擎 if/else 分派；
 * - 未登记的引擎（如规划中的 Oracle / Elasticsearch）在打开/执行前即报错，绝不回退到 MySQL 驱动；
 * - 心跳保活通过 healthCheck 覆盖全部已打开连接（P0-3）。
 */
import type { RowDataPacket } from 'mysql2/promise'
import { createPool } from 'mysql2/promise'
import type {
  ConnectionActionResult,
  DatabaseCharsetResult,
  DatabaseItem,
  MySQLColumnType,
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput,
  TableDataFilter,
  TableDataFilterCondition,
  TableDataFilterOperator,
  TableDefinitionResult,
  TableForeignKeyDefinition,
  TableIndexDefinition
} from '../../shared/connections'
import type { StoredConnection } from '../database/connection-repository'
import { buildSslConfig } from './ssl-helper'
import {
  getMysqlPool,
  destroyMysqlPools,
  getMysqlEditableMetadata,
  listMysqlCharsets
} from './adapters/mysql-adapter'
import {
  getPostgresPool,
  closePostgresPools,
  readPostgreSqlDatabases,
  readPostgreSqlDatabaseDetail,
  executePostgreSqlQuery,
  executePostgreSqlFile,
  readPostgreSqlTableData,
  updatePostgreSqlRow,
  deletePostgreSqlRow,
  getPostgreSqlTableDefinition,
  fetchMorePostgreSqlRows
} from './adapters/postgresql-adapter'
import type { ReadDatabasesOptions } from './adapters/postgresql-adapter'
import {
  closeSqliteHandle,
  readSqliteDatabases,
  executeSqliteQuery,
  executeSqliteFile,
  readSqliteTableData,
  updateSqliteRow,
  deleteSqliteRow,
  getSqliteTableDefinition,
  fetchMoreSqliteRows
} from './adapters/sqlite-adapter'
import {
  closeDuckDbHandle,
  readDuckDbDatabases,
  executeDuckDbQuery,
  executeDuckDbFile,
  readDuckDbTableData,
  updateDuckDbRow,
  deleteDuckDbRow,
  getDuckDbTableDefinition,
  fetchMoreDuckDbRows
} from './adapters/duckdb-adapter'
import {
  closeMssqlPools,
  readMssqlDatabases,
  executeMssqlQuery,
  executeMssqlFile,
  readMssqlTableData,
  updateMssqlRow,
  deleteMssqlRow,
  getMssqlTableDefinition,
  fetchMoreMssqlRows
} from './adapters/sqlserver-adapter'
import {
  closeMongoClients,
  readMongoDatabases,
  executeMongoQuery,
  readMongoTableData,
  updateMongoRow,
  deleteMongoRow,
  getMongoTableDefinition,
  fetchMoreMongoRows
} from './adapters/mongodb-adapter'
import {
  closeChClient,
  readChDatabases,
  executeChQuery,
  readChTableData,
  updateChRow,
  deleteChRow,
  getChTableDefinition,
  fetchMoreChRows
} from './adapters/clickhouse-adapter'
import {
  closeRedisClient,
  readRedisDatabases,
  executeRedisCommand,
  readRedisTableData
} from './adapters/redis-adapter'
import {
  getDmPool,
  closeDmPools,
  readDmDatabases,
  executeDmQuery,
  readDmTableData,
  updateDmRow,
  deleteDmRow,
  getDmTableDefinition,
  fetchMoreDmRows
} from './adapters/dm-adapter'
import {
  getKbPool,
  closeKbPools,
  readKbDatabases,
  executeKbQuery,
  readKbTableData,
  updateKbRow,
  deleteKbRow,
  getKbTableDefinition,
  fetchMoreKbRows
} from './adapters/kingbase-adapter'
import {
  isSelectQuery,
  applyLimit,
  applyLimitOffset,
  QUERY_ROW_LIMIT,
  createCursor,
  updateCursorOffset,
  deleteCursor,
  type QueryCursor
} from './query-cursor-manager'
import { dbWorkerClosePools, dbWorkerMysqlQuery } from './db-query-runtime'

// ── MySQL 元数据行类型 ───────────────────────────────────────────────
interface DatabaseRow extends RowDataPacket {
  databaseName: string
  charset: string
  collation: string
}

interface TableRow extends RowDataPacket {
  databaseName: string
  tableName: string
  comment: string
  dataBytes?: number
}

interface ObjectRow extends RowDataPacket {
  databaseName: string
  objectName: string
}

interface TableObjectRow extends ObjectRow {
  tableName: string
}

interface TableColumnRow extends RowDataPacket {
  databaseName: string
  tableName: string
  columnName: string
  dataType: string
  nullable: string
  columnKey: string
  comment: string
}

interface EditableColumnRow extends RowDataPacket {
  columnName: string
  columnKey: string
}

interface TableDefinitionColumnRow extends RowDataPacket {
  name: string
  dataType: string
  columnType: string
  characterLength: number | null
  numericPrecision: number | null
  numericScale: number | null
  nullable: 'YES' | 'NO'
  columnKey: string
  comment: string
  defaultValue: string | null
  extra: string
}

interface TableDefinitionIndexRow extends RowDataPacket {
  name: string
  nonUnique: number
  indexType: string
  columnName: string
  sequence: number
}

interface TableDefinitionForeignKeyRow extends RowDataPacket {
  name: string
  columnName: string
  referencedTable: string
  referencedColumn: string
  onDelete: TableForeignKeyDefinition['onDelete']
  onUpdate: TableForeignKeyDefinition['onUpdate']
}

// ── 注册表类型 ───────────────────────────────────────────────────────
export interface EngineFetchMoreResult {
  rows: Array<Record<string, unknown>>
  done: boolean
}

export interface EngineRegistryEntry {
  /** 引擎标识（连接配置中的 engine 值） */
  engine: string
  /** 引擎族：同一族共享实现 */
  family: string
  /** 界面展示名 */
  displayName: string
  /** 关闭该引擎的全部运行时资源（连接池 / Worker 池 / 句柄） */
  closeResources?: (connection: StoredConnection, workerPrefix: string) => Promise<void>
  /** 心跳保活；失败时由调用方告警 */
  healthCheck?: (connection: StoredConnection) => Promise<void>
  /** 读取数据库/表元数据 */
  readDatabases: (connection: StoredConnection, options?: ReadDatabasesOptions, persistent?: boolean) => Promise<DatabaseItem[]>
  /** 按需读取单个数据库的完整元数据 */
  readDatabaseDetail?: (connection: StoredConnection, databaseName: string) => Promise<DatabaseItem | null>
  /** 执行单条 SQL */
  execute: (connection: StoredConnection, databaseName: string, sql: string) => Promise<QueryExecutionResult>
  /** 游标分页拉取更多行 */
  fetchMore: (connection: StoredConnection, databaseName: string, cursor: QueryCursor) => Promise<EngineFetchMoreResult>
  /** 读取表数据 */
  readTableData: (
    connection: StoredConnection,
    databaseName: string,
    tableName: string,
    limit: number,
    offset: number,
    filter?: TableDataFilter
  ) => Promise<QueryExecutionResult>
  /** 读取表结构（DDL 设计） */
  getTableDefinition?: (connection: StoredConnection, databaseName: string, tableName: string) => Promise<TableDefinitionResult>
  /** 执行 SQL 文件 */
  executeFile?: (connection: StoredConnection, databaseName: string | undefined, sql: string) => Promise<void>
  /** 行级更新 */
  updateRow?: (connection: StoredConnection, databaseName: string, input: QueryUpdateRowInput) => Promise<ConnectionActionResult>
  /** 行级删除 */
  deleteRow?: (connection: StoredConnection, databaseName: string, input: QueryDeleteRowInput) => Promise<ConnectionActionResult>
  /** 读取可用字符集 */
  listCharsets?: (connection: StoredConnection) => Promise<DatabaseCharsetResult>
}

// ── 通用小工具 ───────────────────────────────────────────────────────
const quoteMysql = (identifier: string): string => `\`${identifier.replaceAll('`', '``')}\``

const quoteMysqlLiteral = (value: string): string => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)

const buildWorkerConfig = (connection: StoredConnection): {
  id: number
  host: string
  port: number
  username: string
  password: string
  sslEnabled: boolean
  sslRejectUnauthorized: boolean
  sslCaPath: string
  sslCertPath: string
  sslKeyPath: string
} => ({
  id: connection.id,
  host: connection.host,
  port: connection.port,
  username: connection.username,
  password: connection.password,
  sslEnabled: connection.sslEnabled,
  sslRejectUnauthorized: connection.sslRejectUnauthorized,
  sslCaPath: connection.sslCaPath,
  sslCertPath: connection.sslCertPath,
  sslKeyPath: connection.sslKeyPath
})

const mysqlWorkerPrefix = (connection: StoredConnection): string =>
  connection.id > 0 ? `id:${connection.id}` : `${connection.host}:${connection.port}:${connection.username}`

// ── MySQL 家族实现 ───────────────────────────────────────────────────
async function readMysqlFamilyDatabases(
  connection: StoredConnection,
  options?: ReadDatabasesOptions,
  persistent = true
): Promise<DatabaseItem[]> {
  const pool = persistent
    ? getMysqlPool(connection)
    : createPool({
        host: connection.host,
        port: connection.port,
        user: connection.username,
        password: connection.password,
        database: undefined,
        connectTimeout: 5000,
        multipleStatements: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        dateStrings: true,
        ssl: buildSslConfig(connection),
        connectionLimit: 3
      })

  const optionalQuery = async <Row extends RowDataPacket>(sql: string): Promise<Row[]> => {
    try {
      const [rows] = await pool.query<Row[]>(sql)
      return rows
    } catch (error) {
      console.warn('读取可选数据库元数据失败：', errorText(error))
      return []
    }
  }

  try {
    // 核心查询：始终只获取库名+表名（元数据懒加载）
    const [[databaseRows], [tableRows]] = await Promise.all([
      pool.query<DatabaseRow[]>(
        `SELECT
          SCHEMA_NAME AS databaseName,
          DEFAULT_CHARACTER_SET_NAME AS charset,
          DEFAULT_COLLATION_NAME AS collation
        FROM information_schema.SCHEMATA
        ORDER BY SCHEMA_NAME`
      ),
      pool.query<TableRow[]>(`
        SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, COALESCE(TABLE_COMMENT, '') AS comment,
          COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS dataBytes
        FROM information_schema.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `)
    ])

    // light 模式仅返回库+表名，不拉取列/索引/外键等详细元数据
    if (options?.light) {
      const tablesByDatabase = new Map<string, DatabaseItem['tables']>()
      for (const table of tableRows) {
        const tables = tablesByDatabase.get(table.databaseName) ?? []
        tables.push({
          name: table.tableName,
          comment: table.comment,
          columns: [],
          indexes: [],
          foreignKeys: [],
          checks: [],
          triggers: []
        })
        tablesByDatabase.set(table.databaseName, tables)
      }
      const dataBytesByDatabase = new Map<string, number>()
      for (const table of tableRows) {
        dataBytesByDatabase.set(table.databaseName, (dataBytesByDatabase.get(table.databaseName) ?? 0) + Number(table.dataBytes ?? 0))
      }
      return databaseRows.map((database: DatabaseRow) => ({
        name: database.databaseName,
        charset: database.charset,
        collation: database.collation,
        dataBytes: dataBytesByDatabase.get(database.databaseName) ?? 0,
        tables: tablesByDatabase.get(database.databaseName) ?? [],
        views: [],
        functions: [],
        procedures: [],
        indexes: [],
        triggers: []
      }))
    }

    // 完整模式：7 个可选查询并行执行（任何一个失败都静默降级）
    const [viewRows, procedureRows, columnRows, indexRows, foreignKeyRows, checkRows, triggerRows] =
      await Promise.all([
        optionalQuery<ObjectRow>(`
          SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS objectName
          FROM information_schema.VIEWS
          ORDER BY TABLE_SCHEMA, TABLE_NAME
        `),
        optionalQuery<ObjectRow>(`
          SELECT ROUTINE_SCHEMA AS databaseName, ROUTINE_NAME AS objectName
          FROM information_schema.ROUTINES
          WHERE ROUTINE_TYPE = 'PROCEDURE'
          ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
        `),
        optionalQuery<TableColumnRow>(`
          SELECT
            TABLE_SCHEMA AS databaseName,
            TABLE_NAME AS tableName,
            COLUMN_NAME AS columnName,
            DATA_TYPE AS dataType,
            IS_NULLABLE AS nullable,
            COLUMN_KEY AS columnKey,
            COALESCE(COLUMN_COMMENT, '') AS comment
          FROM information_schema.COLUMNS
          ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
        `),
        optionalQuery<TableObjectRow>(`
          SELECT DISTINCT
            TABLE_SCHEMA AS databaseName,
            TABLE_NAME AS tableName,
            INDEX_NAME AS objectName
          FROM information_schema.STATISTICS
          ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME
        `),
        optionalQuery<TableObjectRow>(`
          SELECT DISTINCT
            TABLE_SCHEMA AS databaseName,
            TABLE_NAME AS tableName,
            CONCAT(CONSTRAINT_NAME, ' → ', REFERENCED_TABLE_SCHEMA, '.', REFERENCED_TABLE_NAME) AS objectName
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE REFERENCED_TABLE_NAME IS NOT NULL
          ORDER BY databaseName, tableName, objectName
        `),
        optionalQuery<TableObjectRow>(`
          SELECT
            CONSTRAINT_SCHEMA AS databaseName,
            TABLE_NAME AS tableName,
            CONSTRAINT_NAME AS objectName
          FROM information_schema.TABLE_CONSTRAINTS
          WHERE CONSTRAINT_TYPE = 'CHECK'
          ORDER BY CONSTRAINT_SCHEMA, TABLE_NAME, CONSTRAINT_NAME
        `),
        optionalQuery<TableObjectRow>(`
          SELECT
            TRIGGER_SCHEMA AS databaseName,
            EVENT_OBJECT_TABLE AS tableName,
            TRIGGER_NAME AS objectName
          FROM information_schema.TRIGGERS
          ORDER BY TRIGGER_SCHEMA, EVENT_OBJECT_TABLE, TRIGGER_NAME
        `)
      ])

    const tableObjects = (rows: TableObjectRow[]): Map<string, string[]> => {
      const objectsByTable = new Map<string, string[]>()
      for (const row of rows) {
        const key = `${row.databaseName}\u0000${row.tableName}`
        const objects = objectsByTable.get(key) ?? []
        objects.push(row.objectName)
        objectsByTable.set(key, objects)
      }
      return objectsByTable
    }

    const columnsByTable = new Map<string, DatabaseItem['tables'][number]['columns']>()
    for (const row of columnRows) {
      const key = `${row.databaseName}\u0000${row.tableName}`
      const cols = columnsByTable.get(key) ?? []
      cols.push({
        name: row.columnName,
        type: row.dataType,
        nullable: row.nullable === 'YES',
        isPrimaryKey: row.columnKey === 'PRI',
        comment: row.comment || undefined
      })
      columnsByTable.set(key, cols)
    }
    const indexesByTable = tableObjects(indexRows)
    const foreignKeysByTable = tableObjects(foreignKeyRows)
    const checksByTable = tableObjects(checkRows)
    const triggersByTable = tableObjects(triggerRows)
    const tablesByDatabase = new Map<string, DatabaseItem['tables']>()
    for (const table of tableRows) {
      const tables = tablesByDatabase.get(table.databaseName) ?? []
      const tableKey = `${table.databaseName}\u0000${table.tableName}`
      tables.push({
        name: table.tableName,
        comment: table.comment,
        columns: columnsByTable.get(tableKey) ?? [],
        indexes: indexesByTable.get(tableKey) ?? [],
        foreignKeys: foreignKeysByTable.get(tableKey) ?? [],
        checks: checksByTable.get(tableKey) ?? [],
        triggers: triggersByTable.get(tableKey) ?? []
      })
      tablesByDatabase.set(table.databaseName, tables)
    }

    const groupObjects = (rows: ObjectRow[]): Map<string, string[]> => {
      const objectsByDatabase = new Map<string, string[]>()
      for (const row of rows) {
        const objects = objectsByDatabase.get(row.databaseName) ?? []
        objects.push(row.objectName)
        objectsByDatabase.set(row.databaseName, objects)
      }
      return objectsByDatabase
    }

    const viewsByDatabase = groupObjects(viewRows)
    const proceduresByDatabase = groupObjects(procedureRows)
    const dataBytesByDatabase = new Map<string, number>()
    for (const table of tableRows) {
      dataBytesByDatabase.set(table.databaseName, (dataBytesByDatabase.get(table.databaseName) ?? 0) + Number(table.dataBytes ?? 0))
    }

    return databaseRows.map((database: DatabaseRow) => ({
      name: database.databaseName,
      charset: database.charset,
      collation: database.collation,
      dataBytes: dataBytesByDatabase.get(database.databaseName) ?? 0,
      tables: tablesByDatabase.get(database.databaseName) ?? [],
      views: viewsByDatabase.get(database.databaseName) ?? [],
      functions: [],
      procedures: proceduresByDatabase.get(database.databaseName) ?? [],
      indexes: [],
      triggers: []
    }))
  } finally {
    // 临时连接池（测试时）用完立即销毁；持久化连接池交由 close()/delete() 管理
    if (!persistent) await pool.end().catch(() => undefined)
  }
}

async function readMysqlFamilyDatabaseDetail(
  connection: StoredConnection,
  databaseName: string
): Promise<DatabaseItem | null> {
  const pool = getMysqlPool(connection)
  const optionalQuery = async <Row extends RowDataPacket>(sql: string, params?: unknown[]): Promise<Row[]> => {
    try {
      const [rows] = await pool.query<Row[]>(sql, params)
      return rows
    } catch (error) {
      console.warn('读取 MySQL 数据库详情失败：', errorText(error))
      return []
    }
  }
  const [[databaseRows], [tableRows]] = await Promise.all([
    pool.query<DatabaseRow[]>(
      'SELECT SCHEMA_NAME AS databaseName, DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [databaseName]
    ),
    pool.query<TableRow[]>(
      "SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, COALESCE(TABLE_COMMENT, '') AS comment, COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS dataBytes FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
      [databaseName]
    )
  ])
  if (!databaseRows.length) return null
  const [viewRows, procedureRows, columnRows, indexRows, foreignKeyRows, checkRows, triggerRows] = await Promise.all([
    optionalQuery<ObjectRow>('SELECT TABLE_NAME AS objectName FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME', [databaseName]),
    optionalQuery<ObjectRow>("SELECT ROUTINE_NAME AS objectName FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME", [databaseName]),
    optionalQuery<TableColumnRow>('SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey, COALESCE(COLUMN_COMMENT, \'\') AS comment FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION', [databaseName]),
    optionalQuery<TableObjectRow>('SELECT DISTINCT TABLE_NAME AS tableName, INDEX_NAME AS objectName FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME', [databaseName]),
    optionalQuery<TableObjectRow>("SELECT DISTINCT TABLE_NAME AS tableName, CONCAT(CONSTRAINT_NAME, ' → ', REFERENCED_TABLE_SCHEMA, '.', REFERENCED_TABLE_NAME) AS objectName FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, objectName", [databaseName]),
    optionalQuery<TableObjectRow>('SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS objectName FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_TYPE = ? ORDER BY TABLE_NAME, CONSTRAINT_NAME', [databaseName, 'CHECK']),
    optionalQuery<TableObjectRow>('SELECT EVENT_OBJECT_TABLE AS tableName, TRIGGER_NAME AS objectName FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME', [databaseName])
  ])
  const tableObjects = (rows: TableObjectRow[]): Map<string, string[]> => {
    const objectsByTable = new Map<string, string[]>()
    for (const row of rows) {
      const key = `${databaseName}\u0000${row.tableName}`
      const objects = objectsByTable.get(key) ?? []
      objects.push(row.objectName)
      objectsByTable.set(key, objects)
    }
    return objectsByTable
  }
  const columnsByTable = new Map<string, DatabaseItem['tables'][number]['columns']>()
  for (const row of columnRows) {
    const key = `${databaseName}\u0000${row.tableName}`
    const cols = columnsByTable.get(key) ?? []
    cols.push({
      name: row.columnName,
      type: row.dataType,
      nullable: row.nullable === 'YES',
      isPrimaryKey: row.columnKey === 'PRI',
      comment: row.comment || undefined
    })
    columnsByTable.set(key, cols)
  }
  const indexesByTable = tableObjects(indexRows)
  const foreignKeysByTable = tableObjects(foreignKeyRows)
  const checksByTable = tableObjects(checkRows)
  const triggersByTable = tableObjects(triggerRows)
  const tables = tableRows.map((table) => {
    const tableKey = `${databaseName}\u0000${table.tableName}`
    return {
      name: table.tableName,
      comment: table.comment,
      columns: columnsByTable.get(tableKey) ?? [],
      indexes: indexesByTable.get(tableKey) ?? [],
      foreignKeys: foreignKeysByTable.get(tableKey) ?? [],
      checks: checksByTable.get(tableKey) ?? [],
      triggers: triggersByTable.get(tableKey) ?? []
    }
  })
  const dataBytes = tableRows.reduce((sum, table) => sum + Number(table.dataBytes ?? 0), 0)
  return {
    name: databaseName,
    charset: databaseRows[0]?.charset ?? '',
    collation: databaseRows[0]?.collation ?? '',
    dataBytes,
    tables,
    views: viewRows.map((row) => row.objectName),
    functions: [],
    procedures: procedureRows.map((row) => row.objectName),
    indexes: [],
    triggers: []
  }
}

async function executeMysqlFamilyQuery(
  connection: StoredConnection,
  databaseName: string,
  sql: string
): Promise<QueryExecutionResult> {
  const poolKey = mysqlWorkerPrefix(connection)
  const workerConfig = buildWorkerConfig(connection)
  const startTime = new Date().toISOString()
  const startMs = performance.now()
  const executionStats = (success: boolean): Pick<QueryExecutionResult, 'startTime' | 'endTime' | 'durationMs' | 'queryCount' | 'successCount' | 'errorCount'> => ({
    startTime,
    endTime: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startMs),
    queryCount: 1,
    successCount: success ? 1 : 0,
    errorCount: success ? 0 : 1
  })
  try {
    const queryResult = await dbWorkerMysqlQuery(poolKey, workerConfig, databaseName, isSelectQuery(sql) ? applyLimit(sql, QUERY_ROW_LIMIT) : sql)
    if (queryResult.type === 'rows') {
      const rows = queryResult.rows
      const workerFields = queryResult.fields
      const editable = await getMysqlEditableMetadata(workerConfig, databaseName, workerFields)
      const truncated = isSelectQuery(sql) && rows.length >= QUERY_ROW_LIMIT
      let totalRows = rows.length
      if (truncated) {
        const countResult = await dbWorkerMysqlQuery(poolKey, workerConfig, databaseName, `SELECT COUNT(*) AS total FROM (${sql.replace(/;\s*$/, '')}) AS _count_sub`)
        if (countResult.type === 'rows' && countResult.rows[0]) {
          totalRows = Number(countResult.rows[0].total ?? rows.length)
        }
      }
      let cursorId: string | undefined
      if (truncated) {
        const cursor = createCursor({
          connectionId: connection.id,
          engine: 'MySQL',
          connectionKey: `${connection.host}:${connection.port}/${databaseName}`,
          databaseName,
          sql,
          columns: workerFields.map((f) => f.name),
          editable,
          offset: rows.length,
          totalRows
        })
        cursorId = cursor.id
      }
      const msg = truncated ? `查询成功，显示前 ${rows.length} 行（共 ${totalRows} 行）` : `查询成功，共 ${rows.length} 行`
      return {
        success: true,
        message: msg,
        columns: workerFields.map((field) => field.name),
        rows,
        editable,
        ...executionStats(true),
        truncated,
        cursorId,
        totalRows
      }
    }
    const affectedRows = queryResult.affectedRows ?? 0
    return { success: true, message: `执行成功，影响 ${affectedRows} 行`, affectedRows, ...executionStats(true) }
  } catch (error) {
    return { success: false, message: errorText(error), ...executionStats(false) }
  }
}

async function fetchMoreMysqlRows(
  connection: StoredConnection,
  databaseName: string,
  cursor: QueryCursor
): Promise<EngineFetchMoreResult> {
  const poolKey = mysqlWorkerPrefix(connection)
  const workerConfig = buildWorkerConfig(connection)
  const limitedSql = applyLimitOffset(cursor.sql, QUERY_ROW_LIMIT, cursor.offset)
  const queryResult = await dbWorkerMysqlQuery(poolKey, workerConfig, databaseName, limitedSql)
  const mappedRows = queryResult.type === 'rows' ? queryResult.rows : []
  const done = mappedRows.length < QUERY_ROW_LIMIT
  updateCursorOffset(cursor.id, cursor.offset + mappedRows.length)
  if (done) deleteCursor(cursor.id)
  return { rows: mappedRows, done }
}

async function readMysqlFamilyTableData(
  connection: StoredConnection,
  databaseName: string,
  tableName: string,
  safeLimit: number,
  safeOffset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> {
  let whereSql = ''
  if (filter?.filters?.length) {
    try {
      const pool = getMysqlPool(connection, databaseName)
      const [columns] = await pool.query<EditableColumnRow[]>(`
        SELECT COLUMN_NAME AS columnName, COLUMN_KEY AS columnKey
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      `, [databaseName, tableName])
      for (const cond of filter.filters) {
        if (cond.column && !columns.some((column) => column.columnName === cond.column)) {
          return { success: false, message: `筛选字段不存在：${cond.column}` }
        }
      }
    } catch (error) {
      return { success: false, message: errorText(error) }
    }
    const build = (cond: TableDataFilterCondition): string => {
      const column = quoteMysql(cond.column)
      const value = quoteMysqlLiteral(cond.value)
      const conditions: Record<TableDataFilterOperator, string> = {
        equals: `${column} = ${value}`,
        notEquals: `${column} <> ${value}`,
        contains: `CAST(${column} AS CHAR) LIKE ${quoteMysqlLiteral(`%${cond.value}%`)}`,
        startsWith: `CAST(${column} AS CHAR) LIKE ${quoteMysqlLiteral(`${cond.value}%`)}`,
        greaterThan: `${column} > ${value}`,
        greaterThanOrEqual: `${column} >= ${value}`,
        lessThan: `${column} < ${value}`,
        lessThanOrEqual: `${column} <= ${value}`,
        isEmpty: `CAST(${column} AS CHAR) = ''`,
        isEmptyOrNull: `(${column} IS NULL OR CAST(${column} AS CHAR) = '')`,
        isNotEmpty: `(${column} IS NOT NULL AND CAST(${column} AS CHAR) <> '')`,
        isNull: `${column} IS NULL`,
        isNotNull: `${column} IS NOT NULL`
      }
      return conditions[cond.operator]
    }
    whereSql = ` WHERE ${filter.filters.map(build).join(filter.logic === 'OR' ? ' OR ' : ' AND ')}`
  }
  const result = await executeMysqlFamilyQuery(
    connection,
    databaseName,
    `SELECT * FROM ${quoteMysql(tableName)}${whereSql} LIMIT ${safeLimit} OFFSET ${safeOffset}`
  )
  if (result.success && result.rows) {
    return { ...result, message: `已加载 ${result.rows.length} 行数据` }
  }
  return result
}

async function getMysqlFamilyTableDefinition(
  connection: StoredConnection,
  databaseName: string,
  tableName: string
): Promise<TableDefinitionResult> {
  const pool = getMysqlPool(connection, databaseName)
  const [columnRows] = await pool.query<TableDefinitionColumnRow[]>(`
    SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType,
      CHARACTER_MAXIMUM_LENGTH AS characterLength, NUMERIC_PRECISION AS numericPrecision,
      NUMERIC_SCALE AS numericScale, IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey,
      COLUMN_COMMENT AS comment, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [databaseName, tableName])
  if (!columnRows.length) return { success: false, message: '数据表不存在或没有字段' }
  const [tableRows, indexRows, foreignKeyRows] = await Promise.all([
    pool.query<Array<RowDataPacket & { comment: string }>>(`
      SELECT TABLE_COMMENT AS comment FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    `, [databaseName, tableName]),
    pool.query<TableDefinitionIndexRow[]>(`
      SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, INDEX_TYPE AS indexType,
        COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `, [databaseName, tableName]),
    pool.query<TableDefinitionForeignKeyRow[]>(`
      SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName,
        k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn,
        r.DELETE_RULE AS onDelete, r.UPDATE_RULE AS onUpdate
      FROM information_schema.KEY_COLUMN_USAGE k
      JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
    `, [databaseName, tableName])
  ])

  const indexesByName = new Map<string, TableIndexDefinition>()
  indexRows[0].forEach((row) => {
    const index = indexesByName.get(row.name) ?? {
      name: row.name,
      type: row.indexType === 'FULLTEXT' ? 'FULLTEXT' : row.nonUnique ? 'INDEX' : 'UNIQUE',
      columns: []
    }
    index.columns.push(row.columnName)
    indexesByName.set(row.name, index)
  })
  return {
    success: true,
    message: '表结构读取成功',
    tableName,
    tableComment: tableRows[0][0]?.comment ?? '',
    columns: columnRows.map((column) => ({
      name: column.name,
      originalName: column.name,
      type: column.dataType.toUpperCase() as MySQLColumnType,
      typeDefinition: column.columnType,
      length: column.characterLength !== null
        ? String(column.characterLength)
        : column.dataType === 'decimal' && column.numericPrecision !== null ? String(column.numericPrecision) : '',
      decimals: column.dataType === 'decimal' && column.numericScale !== null ? String(column.numericScale) : '',
      notNull: column.nullable === 'NO',
      primaryKey: column.columnKey === 'PRI',
      comment: column.comment,
      defaultValue: column.defaultValue,
      extra: column.extra
    })),
    indexes: Array.from(indexesByName.values()),
    foreignKeys: foreignKeyRows[0].map((foreignKey) => ({
      name: foreignKey.name,
      column: foreignKey.columnName,
      referencedTable: foreignKey.referencedTable,
      referencedColumn: foreignKey.referencedColumn,
      onDelete: foreignKey.onDelete,
      onUpdate: foreignKey.onUpdate
    }))
  }
}

async function updateMysqlFamilyRow(
  connection: StoredConnection,
  databaseName: string,
  input: QueryUpdateRowInput
): Promise<ConnectionActionResult> {
  const pool = getMysqlPool(connection, databaseName)
  const [columnRows] = await pool.query<EditableColumnRow[]>(`
    SELECT COLUMN_NAME AS columnName, COLUMN_KEY AS columnKey
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
  `, [input.databaseName, input.tableName])
  if (!columnRows.length) return { success: false, message: '数据表不存在或已被删除' }

  const validColumns = new Set(columnRows.map((column) => column.columnName))
  const primaryKeys = columnRows.filter((column) => column.columnKey === 'PRI').map((column) => column.columnName)
  const changeColumns = Object.keys(input.changes)
  if (!primaryKeys.length || primaryKeys.some((key) => !(key in input.primaryKeyValues))) {
    return { success: false, message: '查询结果缺少完整主键，无法安全保存' }
  }
  if (changeColumns.some((column) => !validColumns.has(column))) return { success: false, message: '包含无效字段，无法保存' }

  const setSql = changeColumns.map((column) => `${quoteMysql(column)} = ?`).join(', ')
  const whereSql = primaryKeys.map((column) => `${quoteMysql(column)} <=> ?`).join(' AND ')
  const values = [
    ...changeColumns.map((column) => input.changes[column]),
    ...primaryKeys.map((column) => input.primaryKeyValues[column])
  ]
  const [result] = await pool.query(
    `UPDATE ${quoteMysql(input.tableName)} SET ${setSql} WHERE ${whereSql} LIMIT 1`,
    values
  )
  const affectedRows = 'affectedRows' in result ? Number(result.affectedRows) : 0
  return { success: true, message: affectedRows ? '数据已保存' : '数据没有变化' }
}

async function deleteMysqlFamilyRow(
  connection: StoredConnection,
  databaseName: string,
  input: QueryDeleteRowInput
): Promise<ConnectionActionResult> {
  const pool = getMysqlPool(connection, databaseName)
  const [columnRows] = await pool.query<EditableColumnRow[]>(`
    SELECT COLUMN_NAME AS columnName, COLUMN_KEY AS columnKey
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
  `, [input.databaseName, input.tableName])
  const primaryKeys = columnRows.filter((column) => column.columnKey === 'PRI').map((column) => column.columnName)
  if (!primaryKeys.length || primaryKeys.some((key) => !(key in input.primaryKeyValues))) {
    return { success: false, message: '缺少完整主键，无法安全删除数据' }
  }
  const whereSql = primaryKeys.map((column) => `${quoteMysql(column)} <=> ?`).join(' AND ')
  const [result] = await pool.query(
    `DELETE FROM ${quoteMysql(input.tableName)} WHERE ${whereSql} LIMIT 1`,
    primaryKeys.map((column) => input.primaryKeyValues[column])
  )
  const affectedRows = 'affectedRows' in result ? Number(result.affectedRows) : 0
  return affectedRows
    ? { success: true, message: '数据已删除' }
    : { success: false, message: '未找到该数据，可能已被修改或删除' }
}

async function executeMysqlFamilyFile(
  connection: StoredConnection,
  databaseName: string | undefined,
  sql: string
): Promise<void> {
  const pool = getMysqlPool(connection, databaseName, true)
  await pool.query(sql)
}

async function closeMysqlFamilyResources(
  connection: StoredConnection,
  workerPrefix: string
): Promise<void> {
  await Promise.allSettled([
    destroyMysqlPools(connection.id),
    dbWorkerClosePools(workerPrefix, 'mysql')
  ])
}

async function mysqlFamilyHealthCheck(connection: StoredConnection): Promise<void> {
  const pool = getMysqlPool(connection)
  await pool.query('SELECT 1;')
}

const mysqlFamilyCharsets = (connection: StoredConnection): Promise<DatabaseCharsetResult> => listMysqlCharsets(connection)

// ── 各引擎静态字符集 ─────────────────────────────────────────────────
const utf8Charset = (name: string): DatabaseCharsetResult => ({
  success: true,
  message: '编码读取成功',
  charsets: [{ name, description: 'Unicode UTF-8', defaultCollation: 'default', collations: ['default'] }]
})

// ── 注册表 ───────────────────────────────────────────────────────────
const mysqlFamilyEntry = (engine: string, displayName: string): EngineRegistryEntry => ({
  engine,
  family: 'mysql',
  displayName,
  closeResources: closeMysqlFamilyResources,
  healthCheck: mysqlFamilyHealthCheck,
  readDatabases: readMysqlFamilyDatabases,
  readDatabaseDetail: readMysqlFamilyDatabaseDetail,
  execute: executeMysqlFamilyQuery,
  fetchMore: fetchMoreMysqlRows,
  readTableData: readMysqlFamilyTableData,
  getTableDefinition: getMysqlFamilyTableDefinition,
  executeFile: executeMysqlFamilyFile,
  updateRow: updateMysqlFamilyRow,
  deleteRow: deleteMysqlFamilyRow,
  listCharsets: mysqlFamilyCharsets
})

export const engineRegistry: Record<string, EngineRegistryEntry> = {
  MySQL: mysqlFamilyEntry('MySQL', 'MySQL'),
  MariaDB: mysqlFamilyEntry('MariaDB', 'MariaDB'),
  TiDB: mysqlFamilyEntry('TiDB', 'TiDB'),
  PostgreSQL: {
    engine: 'PostgreSQL',
    family: 'postgresql',
    displayName: 'PostgreSQL',
    closeResources: async (connection, workerPrefix) => {
      closePostgresPools(connection)
      await dbWorkerClosePools(workerPrefix, 'pg')
    },
    healthCheck: async (connection) => {
      await getPostgresPool(connection).query('SELECT 1')
    },
    readDatabases: readPostgreSqlDatabases,
    readDatabaseDetail: readPostgreSqlDatabaseDetail,
    execute: executePostgreSqlQuery,
    fetchMore: fetchMorePostgreSqlRows,
    readTableData: readPostgreSqlTableData,
    getTableDefinition: getPostgreSqlTableDefinition,
    executeFile: executePostgreSqlFile,
    updateRow: (connection, _databaseName, input) => updatePostgreSqlRow(connection, input),
    deleteRow: (connection, _databaseName, input) => deletePostgreSqlRow(connection, input),
    listCharsets: () => Promise.resolve(utf8Charset('UTF8'))
  },
  达梦: {
    engine: '达梦',
    family: 'dm',
    displayName: '达梦',
    closeResources: closeDmPools,
    healthCheck: async (connection) => {
      const pool = await getDmPool(connection)
      await pool.query('SELECT 1')
    },
    readDatabases: readDmDatabases,
    execute: executeDmQuery,
    fetchMore: fetchMoreDmRows,
    readTableData: readDmTableData,
    getTableDefinition: getDmTableDefinition,
    updateRow: (connection, databaseName, input) => updateDmRow(connection, databaseName, input),
    deleteRow: (connection, databaseName, input) => deleteDmRow(connection, databaseName, input),
    listCharsets: () => Promise.resolve(utf8Charset('UTF8'))
  },
  人大金仓: {
    engine: '人大金仓',
    family: 'kingbase',
    displayName: '人大金仓',
    closeResources: closeKbPools,
    healthCheck: async (connection) => {
      const pool = await getKbPool(connection)
      await pool.query('SELECT 1')
    },
    readDatabases: readKbDatabases,
    execute: executeKbQuery,
    fetchMore: fetchMoreKbRows,
    readTableData: readKbTableData,
    getTableDefinition: getKbTableDefinition,
    updateRow: (connection, databaseName, input) => updateKbRow(connection, databaseName, input),
    deleteRow: (connection, databaseName, input) => deleteKbRow(connection, databaseName, input),
    listCharsets: () => Promise.resolve(utf8Charset('UTF8'))
  },
  SQLite: {
    engine: 'SQLite',
    family: 'sqlite',
    displayName: 'SQLite',
    closeResources: closeSqliteHandle,
    healthCheck: async (connection) => {
      await executeSqliteQuery(connection, 'SELECT 1')
    },
    readDatabases: readSqliteDatabases,
    readDatabaseDetail: async (connection) => {
      const databases = await readSqliteDatabases(connection)
      return databases[0] ?? null
    },
    execute: (connection, _databaseName, sql) => executeSqliteQuery(connection, sql),
    fetchMore: (connection, _databaseName, cursor) => fetchMoreSqliteRows(connection, cursor),
    readTableData: (connection, _databaseName, tableName, limit, offset, filter) =>
      readSqliteTableData(connection, tableName, limit, offset, filter),
    getTableDefinition: (connection, _databaseName, tableName) => getSqliteTableDefinition(connection, tableName),
    executeFile: (connection, _databaseName, sql) => executeSqliteFile(connection, sql),
    updateRow: (connection, _databaseName, input) => updateSqliteRow(connection, input),
    deleteRow: (connection, _databaseName, input) => deleteSqliteRow(connection, input),
    listCharsets: () => Promise.resolve({
      success: true,
      message: '编码读取成功',
      charsets: [{ name: 'UTF8', description: 'SQLite UTF-8', defaultCollation: 'BINARY', collations: ['BINARY', 'NOCASE', 'RTRIM'] }]
    })
  },
  DuckDB: {
    engine: 'DuckDB',
    family: 'duckdb',
    displayName: 'DuckDB',
    closeResources: closeDuckDbHandle,
    healthCheck: async (connection) => {
      await executeDuckDbQuery(connection, 'SELECT 1')
    },
    readDatabases: readDuckDbDatabases,
    readDatabaseDetail: async (connection) => {
      const databases = await readDuckDbDatabases(connection)
      return databases[0] ?? null
    },
    execute: (connection, _databaseName, sql) => executeDuckDbQuery(connection, sql),
    fetchMore: (connection, _databaseName, cursor) => fetchMoreDuckDbRows(connection, cursor),
    readTableData: (connection, _databaseName, tableName, limit, offset, filter) =>
      readDuckDbTableData(connection, tableName, limit, offset, filter),
    getTableDefinition: (connection, _databaseName, tableName) => getDuckDbTableDefinition(connection, tableName),
    executeFile: (connection, _databaseName, sql) => executeDuckDbFile(connection, sql),
    updateRow: (connection, _databaseName, input) => updateDuckDbRow(connection, input),
    deleteRow: (connection, _databaseName, input) => deleteDuckDbRow(connection, input),
    listCharsets: () => Promise.resolve({
      success: true,
      message: '编码读取成功',
      charsets: [{ name: 'UTF8', description: 'DuckDB UTF-8', defaultCollation: 'NOCASE', collations: ['NOCASE', 'BINARY'] }]
    })
  },
  'SQL Server': {
    engine: 'SQL Server',
    family: 'sqlserver',
    displayName: 'SQL Server',
    closeResources: closeMssqlPools,
    healthCheck: async (connection) => {
      await executeMssqlQuery(connection, connection.defaultDatabase || 'master', 'SELECT 1')
    },
    readDatabases: readMssqlDatabases,
    readDatabaseDetail: async (connection, databaseName) => {
      const databases = await readMssqlDatabases(connection, { light: true })
      return databases.find((db) => db.name === databaseName) ?? null
    },
    execute: executeMssqlQuery,
    fetchMore: fetchMoreMssqlRows,
    readTableData: readMssqlTableData,
    getTableDefinition: getMssqlTableDefinition,
    executeFile: (connection, databaseName, sql) => executeMssqlFile(connection, databaseName ?? '', sql),
    updateRow: (connection, databaseName, input) => updateMssqlRow(connection, databaseName, input),
    deleteRow: (connection, databaseName, input) => deleteMssqlRow(connection, databaseName, input),
    listCharsets: () => Promise.resolve({
      success: true,
      message: '编码读取成功',
      charsets: [{ name: 'NVARCHAR', description: 'SQL Server Unicode', defaultCollation: 'SQL_Latin1_General_CP1_CI_AS', collations: ['SQL_Latin1_General_CP1_CI_AS', 'Latin1_General_100_CI_AS_SC', 'Chinese_PRC_CI_AS'] }]
    })
  },
  MongoDB: {
    engine: 'MongoDB',
    family: 'mongodb',
    displayName: 'MongoDB',
    closeResources: closeMongoClients,
    healthCheck: async (connection) => {
      await readMongoDatabases(connection, { light: true })
    },
    readDatabases: readMongoDatabases,
    readDatabaseDetail: async (connection, databaseName) => {
      const databases = await readMongoDatabases(connection, { light: true })
      return databases.find((db) => db.name === databaseName) ?? null
    },
    execute: executeMongoQuery,
    fetchMore: fetchMoreMongoRows,
    readTableData: readMongoTableData,
    getTableDefinition: getMongoTableDefinition,
    updateRow: (connection, databaseName, input) => updateMongoRow(connection, databaseName, input),
    deleteRow: (connection, databaseName, input) => deleteMongoRow(connection, databaseName, input),
    listCharsets: () => Promise.resolve(utf8Charset('UTF8'))
  },
  ClickHouse: {
    engine: 'ClickHouse',
    family: 'clickhouse',
    displayName: 'ClickHouse',
    closeResources: closeChClient,
    healthCheck: async (connection) => {
      await executeChQuery(connection, connection.defaultDatabase || 'default', 'SELECT 1')
    },
    readDatabases: readChDatabases,
    readDatabaseDetail: async (connection, databaseName) => {
      const databases = await readChDatabases(connection, { light: true })
      return databases.find((db) => db.name === databaseName) ?? null
    },
    execute: executeChQuery,
    fetchMore: fetchMoreChRows,
    readTableData: readChTableData,
    getTableDefinition: getChTableDefinition,
    updateRow: (connection, databaseName, input) => updateChRow(connection, databaseName, input),
    deleteRow: (connection, databaseName, input) => deleteChRow(connection, databaseName, input),
    listCharsets: () => Promise.resolve({
      success: true,
      message: '编码读取成功',
      charsets: [{ name: 'UTF-8', description: 'ClickHouse UTF-8', defaultCollation: 'default', collations: ['default'] }]
    })
  },
  Redis: {
    engine: 'Redis',
    family: 'redis',
    displayName: 'Redis',
    closeResources: closeRedisClient,
    healthCheck: async (connection) => {
      await executeRedisCommand(connection, connection.defaultDatabase, 'PING')
    },
    readDatabases: readRedisDatabases,
    readDatabaseDetail: async (connection, databaseName) => {
      const databases = await readRedisDatabases(connection)
      return databases.find((db) => db.name === databaseName) ?? null
    },
    execute: executeRedisCommand,
    fetchMore: async () => ({ rows: [], done: true }),
    readTableData: readRedisTableData,
    listCharsets: () => Promise.resolve({
      success: true,
      message: '编码读取成功',
      charsets: [{ name: 'UTF-8', description: 'Redis UTF-8', defaultCollation: 'default', collations: ['default'] }]
    })
  }
}

/** 已注册（支持）的引擎标识列表 */
export const SUPPORTED_ENGINES: string[] = Object.keys(engineRegistry)

/** 引擎是否已注册 */
export function isSupportedEngine(engine: string): boolean {
  return Object.prototype.hasOwnProperty.call(engineRegistry, engine)
}

/** 未支持引擎错误：在打开/执行前抛出的明确错误，杜绝回退到错误驱动 */
export class UnsupportedEngineError extends Error {
  constructor(engine: string) {
    super(`暂不支持 ${engine} 引擎（能力规划中，请先移除或更换连接类型）`)
    this.name = 'UnsupportedEngineError'
  }
}

/** 获取注册表条目；未注册引擎抛出 UnsupportedEngineError */
export function requireEngineEntry(engine: string): EngineRegistryEntry {
  const entry = engineRegistry[engine]
  if (!entry) throw new UnsupportedEngineError(engine)
  return entry
}

/** 获取注册表条目；未注册引擎返回 null（调用方按需降级） */
export function engineEntryOrNull(engine: string): EngineRegistryEntry | null {
  return engineRegistry[engine] ?? null
}
