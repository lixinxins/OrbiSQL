import { createConnection } from 'mysql2/promise'
import type { FieldPacket, RowDataPacket } from 'mysql2/promise'
import { readFile, writeFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import { stringify } from 'csv-stringify/sync'
import * as XLSX from 'xlsx'
import type {
  ConnectionActionResult,
  ConnectionGroup,
  CopyTableInput,
  CreateTableInput,
  CreateConnectionInput,
  DatabaseCharset,
  DatabaseCharsetResult,
  DatabaseDefinitionInput,
  DatabaseConnection,
  DatabaseItem,
  MySQLColumnType,
  QueryExecutionResult,
  QueryDeleteRowInput,
  QueryUpdateRowInput,
  RenameTableInput,
  SaveQueryInput,
  SavedQuery,
  TableColumnDefinition,
  TableDataFilter,
  TableDefinitionResult,
  TableForeignKeyDefinition,
  TableIndexDefinition,
  TransferTableDataInput,
  UpdateDatabaseInput,
  UpdateTableInput,
  UpdateConnectionInput
} from '../../shared/connections'
import { ConnectionRepository } from '../database/connection-repository'
import type { StoredConnection } from '../database/connection-repository'
import { buildSslConfig } from './ssl-helper'
import { sshTunnelManager } from './ssh-tunnel-manager'
import { splitSqlStatements } from './sql-statement-splitter'
import { transactionManager } from './transaction-manager'
import {
  createPortableTable,
  deletePostgreSqlRow,
  deleteSqliteRow,
  executePostgreSqlFile,
  executePostgreSqlQuery,
  executeSqliteFile,
  executeSqliteQuery,
  exportPostgreSqlTables,
  exportSqliteTables,
  getPostgreSqlTableDefinition,
  getSqliteTableDefinition,
  readPostgreSqlDatabases,
  readPostgreSqlTableData,
  readSqliteDatabases,
  readSqliteTableData,
  updatePostgreSqlRow,
  updatePostgreSqlTableComment,
  updateSqliteRow,
  updateSqliteTable
} from './database-adapters'

interface DatabaseRow extends RowDataPacket {
  databaseName: string
  charset: string
  collation: string
}

interface TableRow extends RowDataPacket {
  databaseName: string
  tableName: string
  comment: string
}

interface ObjectRow extends RowDataPacket {
  databaseName: string
  objectName: string
}

interface TableObjectRow extends ObjectRow {
  tableName: string
}

interface CharsetRow extends RowDataPacket {
  name: string
  description: string
  defaultCollation: string
}

interface CollationRow extends RowDataPacket {
  charsetName: string
  collationName: string
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

const MYSQL_COLOR = '#f3a83b'
const ENGINE_COLORS: Record<CreateConnectionInput['engine'], string> = {
  MySQL: MYSQL_COLOR,
  PostgreSQL: '#336791',
  SQLite: '#4c9ac0'
}

export class ConnectionService {
  constructor(private readonly repository: ConnectionRepository) {}

  private storedInput(input: CreateConnectionInput, id = -1): StoredConnection {
    return {
      id,
      name: input.name,
      engine: input.engine,
      host: input.host,
      port: input.port,
      username: input.username,
      defaultDatabase: input.defaultDatabase,
      password: input.password,
      savePassword: input.savePassword,
      open: true,
      color: input.color,
      groupId: input.groupId ?? null,
      groupName: '',
      sshEnabled: Boolean(input.ssh?.enabled),
      sshHost: input.ssh?.host || '',
      sshPort: input.ssh?.port || 22,
      sshUsername: input.ssh?.username || '',
      sshAuthType: input.ssh?.authType || 'password',
      sshPassword: input.ssh?.password || '',
      sshPrivateKeyPath: input.ssh?.privateKeyPath || '',
      sshPassphrase: input.ssh?.passphrase || '',
      sslEnabled: Boolean(input.ssl?.enabled),
      sslRejectUnauthorized: input.ssl?.rejectUnauthorized !== false,
      sslCaPath: input.ssl?.caPath || '',
      sslCertPath: input.ssl?.certPath || '',
      sslKeyPath: input.ssl?.keyPath || ''
    }
  }

  private publicSecurity(connection: StoredConnection): Pick<DatabaseConnection, 'ssh' | 'ssl'> {
    return {
      ssh: {
        enabled: connection.sshEnabled,
        host: connection.sshHost,
        port: connection.sshPort,
        username: connection.sshUsername,
        authType: connection.sshAuthType,
        password: '',
        privateKeyPath: connection.sshPrivateKeyPath,
        passphrase: ''
      },
      ssl: {
        enabled: connection.sslEnabled,
        rejectUnauthorized: connection.sslRejectUnauthorized,
        caPath: connection.sslCaPath,
        certPath: connection.sslCertPath,
        keyPath: connection.sslKeyPath
      }
    }
  }

  private async prepareRuntimeConnection(connection: StoredConnection, key: string | number = connection.id): Promise<StoredConnection> {
    const endpoint = await sshTunnelManager.ensureTunnel(key, connection)
    return connection.sshEnabled
      ? { ...connection, host: endpoint.localHost, port: endpoint.localPort, sslServerName: connection.host } as StoredConnection
      : connection
  }

  private runtimeConnection(connection: StoredConnection): StoredConnection {
    const endpoint = sshTunnelManager.getEndpoint(connection.id)
    return endpoint
      ? { ...connection, host: endpoint.localHost, port: endpoint.localPort, sslServerName: connection.host } as StoredConnection
      : connection
  }

  private mysqlOptions(connection: StoredConnection, database?: string, multipleStatements = false) {
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

  async list(): Promise<DatabaseConnection[]> {
    return Promise.all(this.repository.list().map((connection) => this.hydrateConnection(connection)))
  }

  listConnectionGroups(): ConnectionGroup[] { return this.repository.listGroups() }

  createConnectionGroup(name: string): ConnectionActionResult {
    const normalized = name.trim()
    if (!normalized) return { success: false, message: '请输入分组名称' }
    if (normalized.length > 30) return { success: false, message: '分组名称不能超过 30 个字符' }
    try { this.repository.createGroup(normalized); return { success: true, message: '分组已创建' } }
    catch (error) { return { success: false, message: this.errorMessage(error) } }
  }

  deleteConnectionGroup(id: number): ConnectionActionResult {
    try { this.repository.deleteGroup(id); return { success: true, message: '分组已删除，原连接已移至未分组' } }
    catch (error) { return { success: false, message: this.errorMessage(error) } }
  }

  setConnectionGroup(connectionId: number, groupId: number | null): ConnectionActionResult {
    if (!this.repository.getById(connectionId)) return { success: false, message: '连接不存在' }
    if (groupId != null && !this.repository.listGroups().some((group) => group.id === groupId)) return { success: false, message: '分组不存在' }
    this.repository.setConnectionGroup(connectionId, groupId)
    return { success: true, message: groupId == null ? '已移至未分组' : '连接分组已更新' }
  }

  listSavedQueries(connectionId: number, databaseName: string): SavedQuery[] {
    if (!this.repository.getById(connectionId) || !databaseName.trim()) return []
    return this.repository.listSavedQueries(connectionId, databaseName)
  }

  saveQuery(input: SaveQueryInput): ConnectionActionResult {
    if (!this.repository.getById(input.connectionId)) return { success: false, message: '连接不存在' }
    if (!input.databaseName.trim()) return { success: false, message: '请先选择数据库' }
    if (!input.name.trim()) return { success: false, message: '请输入查询名称' }
    if (input.name.trim().length > 80) return { success: false, message: '查询名称不能超过 80 个字符' }
    if (!input.sql.trim()) return { success: false, message: 'SQL 语句不能为空' }
    try {
      this.repository.saveQuery({ ...input, name: input.name.trim() })
      return { success: true, message: '查询语句已保存' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  deleteSavedQuery(id: number, connectionId: number, databaseName: string): ConnectionActionResult {
    if (!this.repository.getById(connectionId)) return { success: false, message: '连接不存在' }
    if (!Number.isInteger(id) || id <= 0 || !databaseName.trim()) return { success: false, message: '查询记录参数不正确' }
    try {
      return this.repository.deleteSavedQuery(id, connectionId, databaseName)
        ? { success: true, message: '已保存的查询已删除' }
        : { success: false, message: '查询记录不存在或已被删除' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async create(input: CreateConnectionInput): Promise<ConnectionActionResult> {
    const validationMessage = this.validate(input)
    if (validationMessage) return { success: false, message: validationMessage }

    try {
      await this.readDatabases(input)
      this.repository.create(input)
      return { success: true, message: '连接已保存' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async update(input: UpdateConnectionInput): Promise<ConnectionActionResult> {
    const validationMessage = this.validate(input)
    if (validationMessage) return { success: false, message: validationMessage }
    const existing = this.repository.getById(input.id)
    if (!existing) return { success: false, message: '连接不存在' }

    try {
      await this.readDatabases({
        ...input,
        password: input.password || existing.password,
        ssh: input.ssh ? {
          ...input.ssh,
          password: input.ssh.password || existing.sshPassword,
          passphrase: input.ssh.passphrase || existing.sshPassphrase
        } : input.ssh
      })
      this.repository.update(input)
      return { success: true, message: '连接已更新' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async open(id: number): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(id)
    if (!connection) return { success: false, message: '连接不存在' }
    try {
      await this.readDatabases(connection)
      this.repository.setOpen(id, true)
      return { success: true, message: '连接已打开' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  close(id: number): ConnectionActionResult {
    if (!this.repository.getById(id)) return { success: false, message: '连接不存在' }
    this.repository.setOpen(id, false)
    sshTunnelManager.closeTunnel(id)
    return { success: true, message: '连接已关闭' }
  }

  duplicate(id: number): ConnectionActionResult {
    try {
      this.repository.duplicate(id)
      return { success: true, message: '连接已复制' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  delete(id: number): ConnectionActionResult {
    if (!this.repository.getById(id)) return { success: false, message: '连接不存在' }
    this.repository.delete(id)
    sshTunnelManager.closeTunnel(id)
    return { success: true, message: '连接已删除' }
  }

  async executeSql(id: number, sql: string, databaseName?: string): Promise<ConnectionActionResult> {
    const stored = this.repository.getById(id)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    const connection = this.runtimeConnection(stored)

    if (connection.engine === 'PostgreSQL') {
      try {
        await executePostgreSqlFile(connection, databaseName, sql)
        return { success: true, message: 'SQL 文件执行成功' }
      } catch (error) {
        return { success: false, message: this.errorMessage(error) }
      }
    }
    if (connection.engine === 'SQLite') {
      try {
        executeSqliteFile(connection, sql)
        return { success: true, message: 'SQL 文件执行成功' }
      } catch (error) {
        return { success: false, message: this.errorMessage(error) }
      }
    }

    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    try {
      client = await createConnection(this.mysqlOptions(connection, databaseName, true))
      await client.query(sql)
      return { success: true, message: 'SQL 文件执行成功' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  async createDatabase(input: DatabaseDefinitionInput): Promise<ConnectionActionResult> {
    const validation = this.validateDatabaseDefinition(input)
    if (validation) return { success: false, message: validation }
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'SQLite') return { success: false, message: 'SQLite 连接即数据库文件，请通过新建连接添加其他文件' }
    if (connection.engine === 'PostgreSQL') {
      const result = await this.executeSql(input.connectionId, `CREATE DATABASE ${this.quoteIdentifierForEngine('PostgreSQL', input.name)} ENCODING 'UTF8'`)
      return result.success ? { success: true, message: '数据库已创建' } : result
    }
    return this.executeDatabaseStatement(
      input.connectionId,
      `CREATE DATABASE ${this.quoteIdentifier(input.name)} CHARACTER SET ${input.charset} COLLATE ${input.collation}`,
      '数据库已创建'
    )
  }

  async updateDatabase(input: UpdateDatabaseInput): Promise<ConnectionActionResult> {
    const validation = this.validateDatabaseDefinition(input)
    if (validation) return { success: false, message: validation }
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'SQLite') return { success: false, message: 'SQLite 数据库名称由文件名决定' }
    if (connection.engine === 'PostgreSQL') {
      if (input.name === input.currentName) return { success: true, message: '数据库没有变化' }
      const result = await this.executeSql(input.connectionId, `ALTER DATABASE ${this.quoteIdentifierForEngine('PostgreSQL', input.currentName)} RENAME TO ${this.quoteIdentifierForEngine('PostgreSQL', input.name)}`)
      return result.success ? { success: true, message: '数据库已更新' } : result
    }
    return this.executeDatabaseStatement(
      input.connectionId,
      `ALTER DATABASE ${this.quoteIdentifier(input.currentName)} CHARACTER SET ${input.charset} COLLATE ${input.collation}`,
      '数据库已更新'
    )
  }

  async deleteDatabase(connectionId: number, databaseName: string): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'SQLite') return { success: false, message: '为避免误删文件，请在连接列表中删除 SQLite 连接' }
    if (connection.engine === 'PostgreSQL') {
      const result = await this.executeSql(connectionId, `DROP DATABASE ${this.quoteIdentifierForEngine('PostgreSQL', databaseName)}`)
      return result.success ? { success: true, message: '数据库已删除' } : result
    }
    return this.executeDatabaseStatement(
      connectionId,
      `DROP DATABASE ${this.quoteIdentifier(databaseName)}`,
      '数据库已删除'
    )
  }

  async executeQuery(connectionId: number, databaseName: string, sql: string, sessionId?: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) return { success: false, message: '请输入 SQL 语句' }
    if (sessionId && transactionManager.has(sessionId)) {
      try { return await transactionManager.execute(sessionId, sql) } catch (error) {
        return { success: false, message: this.errorMessage(error), queryCount: 0, successCount: 0, errorCount: 1 }
      }
    }
    const statements = splitSqlStatements(sql)
    if (statements.length <= 1) return this.executeSingleQuery(connectionId, databaseName, statements[0] ?? sql)
    const stored = this.repository.getById(connectionId)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    try {
      const connection = stored.sshEnabled && !sshTunnelManager.getEndpoint(connectionId)
        ? await this.prepareRuntimeConnection(stored, connectionId)
        : stored
      return await transactionManager.executeBatch(connection, databaseName, sql)
    } catch (error) {
      return { success: false, message: this.errorMessage(error), queryCount: statements.length, successCount: 0, errorCount: 1 }
    }
  }

  async beginTransaction(connectionId: number, databaseName: string, sessionId: string): Promise<ConnectionActionResult> {
    const stored = this.repository.getById(connectionId)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    try {
      const connection = stored.sshEnabled && !sshTunnelManager.getEndpoint(connectionId)
        ? await this.prepareRuntimeConnection(stored, connectionId)
        : stored
      await transactionManager.begin(sessionId, connection, databaseName)
      return { success: true, message: '事务已开始' }
    } catch (error) { return { success: false, message: this.errorMessage(error) } }
  }

  async commitTransaction(sessionId: string): Promise<ConnectionActionResult> {
    try { await transactionManager.commit(sessionId); return { success: true, message: '事务已提交' } }
    catch (error) { return { success: false, message: this.errorMessage(error) } }
  }

  async rollbackTransaction(sessionId: string): Promise<ConnectionActionResult> {
    try { await transactionManager.rollback(sessionId); return { success: true, message: '事务已回滚' } }
    catch (error) { return { success: false, message: this.errorMessage(error) } }
  }

  private async executeSingleQuery(connectionId: number, databaseName: string, sql: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) return { success: false, message: '请输入 SQL 语句' }
    const stored = this.repository.getById(connectionId)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    let connection = stored
    if (stored.sshEnabled && !sshTunnelManager.getEndpoint(connectionId)) {
      try { connection = await this.prepareRuntimeConnection(stored, connectionId) }
      catch (error) { return { success: false, message: this.errorMessage(error) } }
    }

    try {
      if (connection.engine === 'PostgreSQL') return await executePostgreSqlQuery(connection, databaseName, sql)
      if (connection.engine === 'SQLite') return executeSqliteQuery(connection, sql)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }

    let client: Awaited<ReturnType<typeof createConnection>> | null = null
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
      client = await createConnection(this.mysqlOptions(connection, databaseName))
      const [result, fields] = await client.query(sql)
      if (Array.isArray(result)) {
        const rows = result.map((row) => ({ ...(row as Record<string, unknown>) }))
        const editable = await this.getEditableQueryMetadata(client, databaseName, fields)
        return {
          success: true,
          message: `查询成功，共 ${rows.length} 行`,
          columns: fields.map((field) => field.name),
          rows,
          editable,
          ...executionStats(true)
        }
      }
      const affectedRows = 'affectedRows' in result ? Number(result.affectedRows) : 0
      return { success: true, message: `执行成功，影响 ${affectedRows} 行`, affectedRows, ...executionStats(true) }
    } catch (error) {
      return { success: false, message: this.errorMessage(error), ...executionStats(false) }
    } finally {
      if (client) await client.end()
    }
  }

  async updateQueryRow(input: QueryUpdateRowInput): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    if (!Object.keys(input.changes).length) return { success: false, message: '没有需要保存的修改' }

    try {
      if (connection.engine === 'PostgreSQL') return await updatePostgreSqlRow(connection, input)
      if (connection.engine === 'SQLite') return updateSqliteRow(connection, input)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }

    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    try {
      client = await createConnection(this.mysqlOptions(connection, input.databaseName))
      const [columnRows] = await client.query<EditableColumnRow[]>(`
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

      const setSql = changeColumns.map((column) => `${this.quoteIdentifier(column)} = ?`).join(', ')
      const whereSql = primaryKeys.map((column) => `${this.quoteIdentifier(column)} <=> ?`).join(' AND ')
      const values = [
        ...changeColumns.map((column) => input.changes[column]),
        ...primaryKeys.map((column) => input.primaryKeyValues[column])
      ]
      const [result] = await client.query(
        `UPDATE ${this.quoteIdentifier(input.tableName)} SET ${setSql} WHERE ${whereSql} LIMIT 1`,
        values
      )
      const affectedRows = 'affectedRows' in result ? Number(result.affectedRows) : 0
      return { success: true, message: affectedRows ? '数据已保存' : '数据没有变化' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  async deleteQueryRow(input: QueryDeleteRowInput): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    try {
      if (connection.engine === 'PostgreSQL') return await deletePostgreSqlRow(connection, input)
      if (connection.engine === 'SQLite') return deleteSqliteRow(connection, input)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    try {
      client = await createConnection(this.mysqlOptions(connection, input.databaseName))
      const [columnRows] = await client.query<EditableColumnRow[]>(`
        SELECT COLUMN_NAME AS columnName, COLUMN_KEY AS columnKey
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      `, [input.databaseName, input.tableName])
      const primaryKeys = columnRows.filter((column) => column.columnKey === 'PRI').map((column) => column.columnName)
      if (!primaryKeys.length || primaryKeys.some((key) => !(key in input.primaryKeyValues))) {
        return { success: false, message: '缺少完整主键，无法安全删除数据' }
      }
      const whereSql = primaryKeys.map((column) => `${this.quoteIdentifier(column)} <=> ?`).join(' AND ')
      const [result] = await client.query(
        `DELETE FROM ${this.quoteIdentifier(input.tableName)} WHERE ${whereSql} LIMIT 1`,
        primaryKeys.map((column) => input.primaryKeyValues[column])
      )
      const affectedRows = 'affectedRows' in result ? Number(result.affectedRows) : 0
      return affectedRows
        ? { success: true, message: '数据已删除' }
        : { success: false, message: '未找到该数据，可能已被修改或删除' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  async deleteTable(connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine !== 'MySQL') {
      const result = await this.executeQuery(connectionId, databaseName, `DROP TABLE ${this.quoteIdentifierForEngine(connection.engine, tableName)}`)
      return result.success ? { success: true, message: '数据表已删除' } : result
    }
    return this.executeDatabaseStatement(
      connectionId,
      `DROP TABLE ${this.quoteIdentifier(databaseName)}.${this.quoteIdentifier(tableName)}`,
      '数据表已删除'
    )
  }

  async renameTable(input: RenameTableInput): Promise<ConnectionActionResult> {
    const newTableName = input.newTableName.trim()
    if (!newTableName) return { success: false, message: '请输入新的表名称' }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(newTableName)) {
      return { success: false, message: '表名称须以英文字母开头，只能包含英文字母、数字和下划线' }
    }
    if (newTableName === input.currentTableName) return { success: false, message: '新表名称不能与原表相同' }

    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    if (connection.engine === 'MySQL' && newTableName.length > 64) {
      return { success: false, message: 'MySQL 表名称不能超过 64 个字符' }
    }
    if (connection.engine === 'PostgreSQL' && newTableName.length > 63) {
      return { success: false, message: 'PostgreSQL 表名称不能超过 63 个字符' }
    }

    const current = this.quoteIdentifierForEngine(connection.engine, input.currentTableName)
    const target = this.quoteIdentifierForEngine(connection.engine, newTableName)
    const sql = connection.engine === 'MySQL'
      ? `RENAME TABLE ${this.quoteIdentifier(input.databaseName)}.${current} TO ${this.quoteIdentifier(input.databaseName)}.${target}`
      : `ALTER TABLE ${current} RENAME TO ${target}`
    const result = await this.executeQuery(input.connectionId, input.databaseName, sql)
    return result.success ? { success: true, message: '数据表名称已修改' } : result
  }

  async readTableData(
    connectionId: number,
    databaseName: string,
    tableName: string,
    limit: number,
    offset: number,
    filter?: TableDataFilter
  ): Promise<QueryExecutionResult> {
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)))
    const safeOffset = Math.max(0, Math.trunc(offset))
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    try {
      if (connection.engine === 'PostgreSQL') return await readPostgreSqlTableData(connection, databaseName, tableName, safeLimit, safeOffset, filter)
      if (connection.engine === 'SQLite') return readSqliteTableData(connection, tableName, safeLimit, safeOffset, filter)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
    let whereSql = ''
    if (filter?.column) {
      let client: Awaited<ReturnType<typeof createConnection>> | null = null
      try {
        client = await createConnection(this.mysqlOptions(connection, databaseName))
        const [columns] = await client.query<EditableColumnRow[]>(`
          SELECT COLUMN_NAME AS columnName, COLUMN_KEY AS columnKey
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        `, [databaseName, tableName])
        if (!columns.some((column) => column.columnName === filter.column)) {
          return { success: false, message: '筛选字段不存在' }
        }
      } finally {
        if (client) await client.end()
      }
      const column = this.quoteIdentifier(filter.column)
      const value = this.quoteString(filter.value)
      const conditions: Record<TableDataFilter['operator'], string> = {
        equals: `${column} = ${value}`,
        notEquals: `${column} <> ${value}`,
        contains: `CAST(${column} AS CHAR) LIKE ${this.quoteString(`%${filter.value}%`)}`,
        startsWith: `CAST(${column} AS CHAR) LIKE ${this.quoteString(`${filter.value}%`)}`,
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
      whereSql = ` WHERE ${conditions[filter.operator]}`
    }
    const result = await this.executeQuery(
      connectionId,
      databaseName,
      `SELECT * FROM ${this.quoteIdentifier(tableName)}${whereSql} LIMIT ${safeLimit} OFFSET ${safeOffset}`
    )
    if (result.success && result.rows) {
      return { ...result, message: `已加载 ${result.rows.length} 行数据` }
    }
    return result
  }

  async truncateTable(connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine !== 'MySQL') {
      const command = connection.engine === 'SQLite' ? 'DELETE FROM' : 'TRUNCATE TABLE'
      const result = await this.executeQuery(connectionId, databaseName, `${command} ${this.quoteIdentifierForEngine(connection.engine, tableName)}`)
      return result.success ? { success: true, message: '数据表已清空' } : result
    }
    return this.executeDatabaseStatement(
      connectionId,
      `TRUNCATE TABLE ${this.quoteIdentifier(databaseName)}.${this.quoteIdentifier(tableName)}`,
      '数据表已清空'
    )
  }

  async copyTable(input: CopyTableInput): Promise<ConnectionActionResult> {
    if (!input.targetTableName.trim()) return { success: false, message: '请输入新表名称' }
    const targetDb = input.targetDatabaseName || input.databaseName
    if ((!input.targetDatabaseName || input.targetDatabaseName === input.databaseName) && input.targetTableName === input.sourceTableName) {
      return { success: false, message: '同一数据库下新表名称不能与原表相同' }
    }
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    if (connection.engine !== 'MySQL') {
      const source = this.quoteIdentifierForEngine(connection.engine, input.sourceTableName)
      const target = this.quoteIdentifierForEngine(connection.engine, input.targetTableName)
      const createSql = connection.engine === 'PostgreSQL'
        ? `CREATE TABLE ${target} (LIKE ${source} INCLUDING ALL)`
        : `CREATE TABLE ${target} AS SELECT * FROM ${source} WHERE 0`
      const created = await this.executeQuery(input.connectionId, targetDb, createSql)
      if (!created.success) return created
      if (input.includeData) {
        const copied = await this.executeQuery(input.connectionId, targetDb, `INSERT INTO ${target} SELECT * FROM ${source}`)
        if (!copied.success) {
          await this.executeQuery(input.connectionId, targetDb, `DROP TABLE ${target}`)
          return copied
        }
      }
      return { success: true, message: input.includeData ? '表结构和数据已复制' : '表结构已复制' }
    }

    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    let tableCreated = false
    try {
      client = await createConnection(this.mysqlOptions(connection, targetDb))
      const srcFull = `${this.quoteIdentifier(input.databaseName)}.${this.quoteIdentifier(input.sourceTableName)}`
      const tgtFull = `${this.quoteIdentifier(targetDb)}.${this.quoteIdentifier(input.targetTableName)}`
      await client.query(
        `CREATE TABLE ${tgtFull} LIKE ${srcFull}`
      )
      tableCreated = true
      if (input.includeData) {
        await client.query(
          `INSERT INTO ${tgtFull} SELECT * FROM ${srcFull}`
        )
      }
      return { success: true, message: input.includeData ? '表结构和数据已复制' : '表结构已复制' }
    } catch (error) {
      if (client && tableCreated) {
        try { await client.query(`DROP TABLE ${this.quoteIdentifier(targetDb)}.${this.quoteIdentifier(input.targetTableName)}`) } catch { /* 保留原始错误 */ }
      }
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  private async getEditableQueryMetadata(
    client: Awaited<ReturnType<typeof createConnection>>,
    databaseName: string,
    fields: FieldPacket[]
  ): Promise<QueryExecutionResult['editable']> {
    const sourceTables = Array.from(new Set(fields.map((field) => field.orgTable).filter(Boolean)))
    if (sourceTables.length !== 1) return undefined
    const tableName = sourceTables[0]
    const [columnRows] = await client.query<EditableColumnRow[]>(`
      SELECT COLUMN_NAME AS columnName, COLUMN_KEY AS columnKey
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `, [databaseName, tableName])
    const primaryKeys = columnRows.filter((column) => column.columnKey === 'PRI').map((column) => column.columnName)
    if (!primaryKeys.length || primaryKeys.some((key) => !fields.some((field) => field.orgName === key))) return undefined
    const validColumns = new Set(columnRows.map((column) => column.columnName))
    return {
      tableName,
      primaryKeys,
      columns: fields
        .filter((field) => field.orgTable === tableName && validColumns.has(field.orgName))
        .map((field) => ({
          resultName: field.name,
          sourceName: field.orgName,
          primaryKey: primaryKeys.includes(field.orgName)
        }))
    }
  }

  async listCharsets(connectionId: number): Promise<DatabaseCharsetResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    if (connection.engine === 'PostgreSQL') return { success: true, message: '编码读取成功', charsets: [{ name: 'UTF8', description: 'Unicode UTF-8', defaultCollation: 'default', collations: ['default'] }] }
    if (connection.engine === 'SQLite') return { success: true, message: '编码读取成功', charsets: [{ name: 'UTF8', description: 'SQLite UTF-8', defaultCollation: 'BINARY', collations: ['BINARY', 'NOCASE', 'RTRIM'] }] }

    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    try {
      client = await createConnection(this.mysqlOptions(connection))
      const [charsetRows] = await client.query<CharsetRow[]>(`
        SELECT
          CHARACTER_SET_NAME AS name,
          DESCRIPTION AS description,
          DEFAULT_COLLATE_NAME AS defaultCollation
        FROM information_schema.CHARACTER_SETS
        ORDER BY CHARACTER_SET_NAME
      `)
      const [collationRows] = await client.query<CollationRow[]>(`
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
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  async createTable(input: CreateTableInput): Promise<ConnectionActionResult> {
    if (!input.tableName.trim()) return { success: false, message: '请输入表名称' }
    if (!input.columns.length) return { success: false, message: '请至少添加一个字段' }
    if ((input.tableComment ?? '').length > 2048) return { success: false, message: '表注释不能超过 2048 个字符' }
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'PostgreSQL' || connection.engine === 'SQLite') {
      return createPortableTable(connection, connection.engine, input)
    }
    const columnNames = new Set<string>()
    const definitions: string[] = []

    for (const column of input.columns) {
      if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
      if (columnNames.has(column.name)) return { success: false, message: `字段“${column.name}”重复` }
      columnNames.add(column.name)
      const definition = this.buildColumnDefinition({ ...column, typeDefinition: undefined, extra: undefined })
      if (!definition) return { success: false, message: `字段“${column.name}”类型或长度不正确` }
      definitions.push(definition)
    }

    const primaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => this.quoteIdentifier(column.name))
    if (primaryKeys.length) definitions.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)

    for (const index of input.indexes) {
      if (!index.name.trim()) return { success: false, message: '索引名称不能为空' }
      if (!index.columns.length) return { success: false, message: `索引“${index.name}”必须选择字段` }
      if (index.columns.some((column) => !columnNames.has(column))) return { success: false, message: `索引“${index.name}”包含不存在的字段` }
      const indexType = index.type === 'UNIQUE' ? 'UNIQUE KEY' : index.type === 'FULLTEXT' ? 'FULLTEXT KEY' : 'KEY'
      definitions.push(`${indexType} ${this.quoteIdentifier(index.name)} (${index.columns.map((column) => this.quoteIdentifier(column)).join(', ')})`)
    }

    const referenceActions = new Set(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'])
    for (const foreignKey of input.foreignKeys) {
      if (!foreignKey.name.trim()) return { success: false, message: '外键名称不能为空' }
      if (!columnNames.has(foreignKey.column)) return { success: false, message: `外键“${foreignKey.name}”字段不存在` }
      if (!foreignKey.referencedTable || !foreignKey.referencedColumn) return { success: false, message: `外键“${foreignKey.name}”缺少引用表或字段` }
      if (!referenceActions.has(foreignKey.onDelete) || !referenceActions.has(foreignKey.onUpdate)) return { success: false, message: '外键动作不正确' }
      definitions.push([
        `CONSTRAINT ${this.quoteIdentifier(foreignKey.name)}`,
        `FOREIGN KEY (${this.quoteIdentifier(foreignKey.column)})`,
        `REFERENCES ${this.quoteIdentifier(foreignKey.referencedTable)} (${this.quoteIdentifier(foreignKey.referencedColumn)})`,
        `ON DELETE ${foreignKey.onDelete}`,
        `ON UPDATE ${foreignKey.onUpdate}`
      ].join(' '))
    }

    return this.executeDatabaseStatement(
      input.connectionId,
      `CREATE TABLE ${this.quoteIdentifier(input.databaseName)}.${this.quoteIdentifier(input.tableName)} (${definitions.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4${input.tableComment ? ` COMMENT=${this.quoteString(input.tableComment)}` : ''}`,
      '数据表已创建'
    )
  }

  async getTableDefinition(
    connectionId: number,
    databaseName: string,
    tableName: string
  ): Promise<TableDefinitionResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    try {
      if (connection.engine === 'PostgreSQL') return await getPostgreSqlTableDefinition(connection, databaseName, tableName)
      if (connection.engine === 'SQLite') return getSqliteTableDefinition(connection, tableName)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    try {
      client = await createConnection(this.mysqlOptions(connection, databaseName))
      const [columnRows] = await client.query<TableDefinitionColumnRow[]>(`
        SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType,
          CHARACTER_MAXIMUM_LENGTH AS characterLength, NUMERIC_PRECISION AS numericPrecision,
          NUMERIC_SCALE AS numericScale, IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey,
          COLUMN_COMMENT AS comment, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [databaseName, tableName])
      if (!columnRows.length) return { success: false, message: '数据表不存在或没有字段' }
      const [tableRows] = await client.query<Array<RowDataPacket & { comment: string }>>(`
        SELECT TABLE_COMMENT AS comment FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      `, [databaseName, tableName])
      const [indexRows] = await client.query<TableDefinitionIndexRow[]>(`
        SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, INDEX_TYPE AS indexType,
          COLUMN_NAME AS columnName, SEQ_IN_INDEX AS sequence
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY'
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
      `, [databaseName, tableName])
      const [foreignKeyRows] = await client.query<TableDefinitionForeignKeyRow[]>(`
        SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName,
          k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn,
          r.DELETE_RULE AS onDelete, r.UPDATE_RULE AS onUpdate
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r
          ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
      `, [databaseName, tableName])

      const indexesByName = new Map<string, TableIndexDefinition>()
      indexRows.forEach((row) => {
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
        tableComment: tableRows[0]?.comment ?? '',
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
        foreignKeys: foreignKeyRows.map((foreignKey) => ({
          name: foreignKey.name,
          column: foreignKey.columnName,
          referencedTable: foreignKey.referencedTable,
          referencedColumn: foreignKey.referencedColumn,
          onDelete: foreignKey.onDelete,
          onUpdate: foreignKey.onUpdate
        }))
      }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  async updateTable(input: UpdateTableInput): Promise<ConnectionActionResult> {
    if (!input.tableName.trim()) return { success: false, message: '请输入表名称' }
    if (!input.columns.length) return { success: false, message: '请至少保留一个字段' }
    if ((input.tableComment ?? '').length > 2048) return { success: false, message: '表注释不能超过 2048 个字符' }
    const targetConnection = this.repository.getById(input.connectionId)
    if (!targetConnection) return { success: false, message: '连接不存在' }
    if (targetConnection.engine === 'SQLite') return updateSqliteTable(targetConnection, input)
    if (targetConnection.engine === 'PostgreSQL') {
      const currentDefinition = await getPostgreSqlTableDefinition(targetConnection, input.databaseName, input.currentTableName)
      if (!currentDefinition.success || !currentDefinition.columns || !currentDefinition.indexes || !currentDefinition.foreignKeys) return currentDefinition
      const columnSignature = (columns: TableColumnDefinition[]): string => JSON.stringify(columns.map((column) => [
        column.name, column.originalName, column.type, column.typeDefinition, column.length, column.decimals,
        column.notNull, column.primaryKey, column.comment, column.defaultValue, column.extra
      ]))
      const indexSignature = (indexes: TableIndexDefinition[]): string => JSON.stringify(indexes.map((index) => [index.name, index.type, index.columns]))
      const foreignKeySignature = (foreignKeys: TableForeignKeyDefinition[]): string => JSON.stringify(foreignKeys.map((foreignKey) => [
        foreignKey.name, foreignKey.column, foreignKey.referencedTable, foreignKey.referencedColumn, foreignKey.onDelete, foreignKey.onUpdate
      ]))
      const structureChanged = input.tableName !== input.currentTableName
        || columnSignature(input.columns) !== columnSignature(currentDefinition.columns)
        || indexSignature(input.indexes) !== indexSignature(currentDefinition.indexes)
        || foreignKeySignature(input.foreignKeys) !== foreignKeySignature(currentDefinition.foreignKeys)
      if (structureChanged) return { success: false, message: 'PostgreSQL 当前仅支持在设计器中修改表注释；字段结构请使用 ALTER TABLE' }
      return updatePostgreSqlTableComment(targetConnection, input.databaseName, input.currentTableName, input.tableComment)
    }
    if (targetConnection.engine !== 'MySQL') {
      return { success: false, message: `${targetConnection.engine} 暂不支持在设计器中修改已有表结构，请使用查询页面执行 ALTER TABLE` }
    }
    const current = await this.getTableDefinition(input.connectionId, input.databaseName, input.currentTableName)
    if (!current.success || !current.columns || !current.indexes || !current.foreignKeys) return current

    const names = new Set<string>()
    for (const column of input.columns) {
      if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
      if (names.has(column.name)) return { success: false, message: `字段“${column.name}”重复` }
      names.add(column.name)
    }

    const clauses: string[] = []
    const indexSignature = (index: TableIndexDefinition): string => JSON.stringify([index.type, index.columns])
    const foreignKeySignature = (foreignKey: TableForeignKeyDefinition): string => JSON.stringify([
      foreignKey.column, foreignKey.referencedTable, foreignKey.referencedColumn, foreignKey.onDelete, foreignKey.onUpdate
    ])
    const inputIndexes = new Map(input.indexes.map((index) => [index.name, index]))
    const inputForeignKeys = new Map(input.foreignKeys.map((foreignKey) => [foreignKey.name, foreignKey]))
    current.foreignKeys
      .filter((foreignKey) => foreignKeySignature(foreignKey) !== foreignKeySignature(inputForeignKeys.get(foreignKey.name) ?? foreignKey) || !inputForeignKeys.has(foreignKey.name))
      .forEach((foreignKey) => clauses.push(`DROP FOREIGN KEY ${this.quoteIdentifier(foreignKey.name)}`))
    current.indexes
      .filter((index) => indexSignature(index) !== indexSignature(inputIndexes.get(index.name) ?? index) || !inputIndexes.has(index.name))
      .forEach((index) => clauses.push(`DROP INDEX ${this.quoteIdentifier(index.name)}`))

    const currentPrimaryKeys = current.columns.filter((column) => column.primaryKey).map((column) => column.name)
    const nextPrimaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => column.name)
    const primaryChanged = JSON.stringify(currentPrimaryKeys) !== JSON.stringify(nextPrimaryKeys)
    if (currentPrimaryKeys.length && primaryChanged) clauses.push('DROP PRIMARY KEY')

    const retainedOriginalNames = new Set(input.columns.map((column) => column.originalName).filter(Boolean))
    current.columns
      .filter((column) => !retainedOriginalNames.has(column.name))
      .forEach((column) => clauses.push(`DROP COLUMN ${this.quoteIdentifier(column.name)}`))

    for (const column of input.columns) {
      const original = column.originalName
        ? current.columns.find((currentColumn) => currentColumn.name === column.originalName)
        : undefined
      const safeColumn = original && original.type === column.type && original.typeDefinition === column.typeDefinition
        ? { ...column, typeDefinition: original.typeDefinition, extra: original.extra }
        : { ...column, typeDefinition: undefined, extra: undefined }
      const definition = this.buildColumnDefinition(safeColumn)
      if (!definition) return { success: false, message: `字段“${column.name}”类型或长度不正确` }
      const changed = !original || JSON.stringify([
        column.name, column.type, column.typeDefinition, column.length, column.decimals,
        column.notNull, column.primaryKey, column.comment, column.defaultValue, column.extra
      ]) !== JSON.stringify([
        original.name, original.type, original.typeDefinition, original.length, original.decimals,
        original.notNull, original.primaryKey, original.comment, original.defaultValue, original.extra
      ])
      if (changed) clauses.push(original
        ? `CHANGE COLUMN ${this.quoteIdentifier(original.name)} ${definition}`
        : `ADD COLUMN ${definition}`)
    }

    const primaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => this.quoteIdentifier(column.name))
    if (primaryKeys.length && primaryChanged) clauses.push(`ADD PRIMARY KEY (${primaryKeys.join(', ')})`)
    for (const index of input.indexes) {
      if (!index.name.trim() || !index.columns.length || index.columns.some((column) => !names.has(column))) {
        return { success: false, message: `索引“${index.name || '未命名'}”设置不正确` }
      }
      const currentIndex = current.indexes.find((item) => item.name === index.name)
      if (currentIndex && indexSignature(currentIndex) === indexSignature(index)) continue
      const type = index.type === 'UNIQUE' ? 'UNIQUE INDEX' : index.type === 'FULLTEXT' ? 'FULLTEXT INDEX' : 'INDEX'
      clauses.push(`ADD ${type} ${this.quoteIdentifier(index.name)} (${index.columns.map((column) => this.quoteIdentifier(column)).join(', ')})`)
    }
    for (const foreignKey of input.foreignKeys) {
      if (!foreignKey.name || !names.has(foreignKey.column) || !foreignKey.referencedTable || !foreignKey.referencedColumn) {
        return { success: false, message: `外键“${foreignKey.name || '未命名'}”设置不正确` }
      }
      const currentForeignKey = current.foreignKeys.find((item) => item.name === foreignKey.name)
      if (currentForeignKey && foreignKeySignature(currentForeignKey) === foreignKeySignature(foreignKey)) continue
      clauses.push([
        `ADD CONSTRAINT ${this.quoteIdentifier(foreignKey.name)}`,
        `FOREIGN KEY (${this.quoteIdentifier(foreignKey.column)})`,
        `REFERENCES ${this.quoteIdentifier(foreignKey.referencedTable)} (${this.quoteIdentifier(foreignKey.referencedColumn)})`,
        `ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`
      ].join(' '))
    }

    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    try {
      client = await createConnection(this.mysqlOptions(connection, input.databaseName))
      if (clauses.length) await client.query(`ALTER TABLE ${this.quoteIdentifier(input.currentTableName)} ${clauses.join(', ')}`)
      if ((current.tableComment ?? '') !== input.tableComment) {
        await client.query(`ALTER TABLE ${this.quoteIdentifier(input.currentTableName)} COMMENT = ${this.quoteString(input.tableComment)}`)
      }
      if (input.tableName !== input.currentTableName) {
        await client.query(`RENAME TABLE ${this.quoteIdentifier(input.currentTableName)} TO ${this.quoteIdentifier(input.tableName)}`)
      }
      return { success: true, message: '数据表结构已保存' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  async importTableData(
    connectionId: number,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    try {
      const extension = filePath.split('.').pop()?.toLowerCase()
      let rows: Array<Record<string, unknown>>
      if (extension === 'json') {
        const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
        const list = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
            ? (parsed as { data: unknown[] }).data
            : []
        rows = list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      } else if (extension === 'xlsx' || extension === 'xls') {
        const workbook = XLSX.read(await readFile(filePath), { type: 'buffer', cellDates: true })
        const sheetName = workbook.SheetNames[0]
        rows = sheetName ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null }) : []
      } else {
        const content = await readFile(filePath, 'utf8')
        rows = parse(content, {
          bom: true,
          columns: true,
          skip_empty_lines: true,
          relax_column_count: true,
          trim: false
        }) as Array<Record<string, unknown>>
      }
      if (!rows.length) return { success: false, message: '文件没有可导入的数据，请确认首个工作表或 JSON 数组包含记录' }
      const headers = Object.keys(rows[0])
      if (!headers.length) return { success: false, message: '文件缺少字段名称' }

      if (connection.engine !== 'MySQL') {
        const databases = await this.readDatabases(connection)
        const table = databases.flatMap((database) => database.tables).find((item) => item.name === tableName)
        if (!table) return { success: false, message: '数据表不存在或已被删除' }
        const unknownHeaders = headers.filter((header) => !table.columns.includes(header))
        if (unknownHeaders.length) return { success: false, message: `导入字段不存在：${unknownHeaders.join('、')}` }
        const escapedColumns = headers.map((header) => this.quoteIdentifierForEngine(connection.engine, header)).join(', ')
        for (let index = 0; index < rows.length; index += 200) {
          const batch = rows.slice(index, index + 200)
          const values = batch.map((row) => `(${headers.map((header) => row[header] == null ? 'NULL' : this.quotePortableString(String(row[header]))).join(', ')})`).join(', ')
          const inserted = await this.executeQuery(
            connectionId,
            databaseName,
            `INSERT INTO ${this.quoteIdentifierForEngine(connection.engine, tableName)} (${escapedColumns}) VALUES ${values}`
          )
          if (!inserted.success) return inserted
        }
        return { success: true, message: `导入成功，共写入 ${rows.length} 行` }
      }

      client = await createConnection(this.mysqlOptions(connection, databaseName))
      const [columnRows] = await client.query<Array<RowDataPacket & { columnName: string }>>(
        `SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [databaseName, tableName]
      )
      const availableColumns = new Set(columnRows.map((row) => row.columnName))
      const unknownHeaders = headers.filter((header) => !availableColumns.has(header))
      if (unknownHeaders.length) return { success: false, message: `导入字段不存在：${unknownHeaders.join('、')}` }

      const escapedColumns = headers.map((header) => this.quoteIdentifier(header)).join(', ')
      const batchSize = 500
      for (let index = 0; index < rows.length; index += batchSize) {
        const batch = rows.slice(index, index + batchSize)
        const placeholders = batch.map(() => `(${headers.map(() => '?').join(', ')})`).join(', ')
        const values = batch.flatMap((row) => headers.map((header) => row[header]))
        await client.query(
          `INSERT INTO ${this.quoteIdentifier(tableName)} (${escapedColumns}) VALUES ${placeholders}`,
          values
        )
      }
      return { success: true, message: `导入成功，共写入 ${rows.length} 行` }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  async importTableCsv(connectionId: number, databaseName: string, tableName: string, filePath: string): Promise<ConnectionActionResult> {
    return this.importTableData(connectionId, databaseName, tableName, filePath)
  }

  async exportTableCsv(
    connectionId: number,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    if (connection.engine !== 'MySQL') {
      try {
        const result = await this.executeQuery(connectionId, databaseName, `SELECT * FROM ${this.quoteIdentifierForEngine(connection.engine, tableName)}`)
        if (!result.success || !result.rows) return result
        const csv = stringify(result.rows, { header: true, bom: true })
        await writeFile(filePath, csv, 'utf8')
        return { success: true, message: `导出成功，共 ${result.rows.length} 行` }
      } catch (error) {
        return { success: false, message: this.errorMessage(error) }
      }
    }

    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    try {
      client = await createConnection(this.mysqlOptions(connection, databaseName))
      const [rows] = await client.query<RowDataPacket[]>(
        `SELECT * FROM ${this.quoteIdentifier(tableName)}`
      )
      const csv = stringify(rows.map((row) => ({ ...row })), { header: true, bom: true })
      await writeFile(filePath, csv, 'utf8')
      return { success: true, message: `导出成功，共 ${rows.length} 行` }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  async transferTableData(input: TransferTableDataInput): Promise<ConnectionActionResult> {
    const source = this.repository.getById(input.sourceConnectionId)
    const target = this.repository.getById(input.targetConnectionId)
    if (!source || !target) return { success: false, message: '源连接或目标连接不存在' }
    if (!source.open || !target.open) return { success: false, message: '请先打开源连接和目标连接' }
    if (input.sourceConnectionId === input.targetConnectionId && input.sourceDatabaseName === input.targetDatabaseName && input.sourceTableName === input.targetTableName) {
      return { success: false, message: '源表和目标表不能相同' }
    }
    try {
      const [sourceDefinition, targetDefinition] = await Promise.all([
        this.getTableDefinition(input.sourceConnectionId, input.sourceDatabaseName, input.sourceTableName),
        this.getTableDefinition(input.targetConnectionId, input.targetDatabaseName, input.targetTableName)
      ])
      if (!sourceDefinition.success || !targetDefinition.success) return { success: false, message: sourceDefinition.success ? targetDefinition.message : sourceDefinition.message }
      const targetNames = new Set((targetDefinition.columns ?? []).map((column) => column.name))
      const columns = (sourceDefinition.columns ?? []).map((column) => column.name).filter((name) => targetNames.has(name))
      if (!columns.length) return { success: false, message: '源表和目标表没有同名字段，无法自动传输' }
      if (input.clearTarget) {
        const cleared = await this.executeQuery(input.targetConnectionId, input.targetDatabaseName, `DELETE FROM ${this.quoteIdentifierForEngine(target.engine, input.targetTableName)}`)
        if (!cleared.success) return { success: false, message: `清空目标表失败：${cleared.message}` }
      }
      const sqlValue = (value: unknown): string => {
        if (value === null || value === undefined) return 'NULL'
        if (typeof value === 'number' && Number.isFinite(value)) return String(value)
        if (typeof value === 'bigint') return String(value)
        if (typeof value === 'boolean') return value ? '1' : '0'
        if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
        const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value)
        return this.quotePortableString(text)
      }
      const quotedColumns = columns.map((column) => this.quoteIdentifierForEngine(target.engine, column)).join(', ')
      let offset = 0
      let transferred = 0
      const pageSize = 500
      while (true) {
        const page = await this.readTableData(input.sourceConnectionId, input.sourceDatabaseName, input.sourceTableName, pageSize, offset)
        if (!page.success || !page.rows) return { success: false, message: page.message }
        if (!page.rows.length) break
        for (let index = 0; index < page.rows.length; index += 100) {
          const batch = page.rows.slice(index, index + 100)
          const values = batch.map((row) => `(${columns.map((column) => sqlValue(row[column])).join(', ')})`).join(', ')
          const inserted = await this.executeQuery(input.targetConnectionId, input.targetDatabaseName, `INSERT INTO ${this.quoteIdentifierForEngine(target.engine, input.targetTableName)} (${quotedColumns}) VALUES ${values}`)
          if (!inserted.success) return { success: false, message: `已传输 ${transferred} 行，写入失败：${inserted.message}` }
          transferred += batch.length
        }
        offset += page.rows.length
        if (page.rows.length < pageSize) break
      }
      return { success: true, message: `数据传输完成，共写入 ${transferred} 行，匹配 ${columns.length} 个字段` }
    } catch (error) { return { success: false, message: this.errorMessage(error) } }
  }

  async exportSql(
    connectionId: number,
    databaseName: string,
    filePath: string,
    includeData: boolean,
    tableName?: string
  ): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    try {
      const databases = await this.readDatabases(connection)
      const database = databases.find((item) => item.name === databaseName)
      if (!database) return { success: false, message: '数据库不存在或无法读取' }
      const tableNames = tableName ? [tableName] : database.tables.map((table) => table.name)
      if (tableName && !database.tables.some((table) => table.name === tableName)) {
        return { success: false, message: '数据表不存在或已被删除' }
      }

      if (connection.engine === 'PostgreSQL') {
        const sql = await exportPostgreSqlTables(connection, databaseName, tableNames, includeData)
        await writeFile(filePath, sql, 'utf8')
      } else if (connection.engine === 'SQLite') {
        const sql = exportSqliteTables(connection, tableNames, includeData)
        await writeFile(filePath, sql, 'utf8')
      } else {
        const client = await createConnection(this.mysqlOptions(connection, databaseName))
        try {
          const statements = [
            `-- OrbiSQL MySQL export: ${databaseName}`,
            `-- Generated at ${new Date().toISOString()}`,
            '',
            `CREATE DATABASE IF NOT EXISTS ${this.quoteIdentifier(databaseName)};`,
            `USE ${this.quoteIdentifier(databaseName)};`,
            'SET FOREIGN_KEY_CHECKS=0;'
          ]
          for (const name of tableNames) {
            const table = this.quoteIdentifier(name)
            const [createRows] = await client.query<RowDataPacket[]>(`SHOW CREATE TABLE ${table}`)
            const createSql = createRows[0]?.['Create Table']
            if (!createSql) continue
            statements.push('', `DROP TABLE IF EXISTS ${table};`, `${String(createSql)};`)
            if (includeData) {
              const [rows, fields] = await client.query<RowDataPacket[]>(`SELECT * FROM ${table}`)
              const names = fields.map((field) => field.name)
              for (const row of rows) {
                statements.push(`INSERT INTO ${table} (${names.map((column) => this.quoteIdentifier(column)).join(', ')}) VALUES (${names.map((column) => this.mysqlDumpValue(row[column])).join(', ')});`)
              }
            }
          }
          statements.push('', 'SET FOREIGN_KEY_CHECKS=1;', '')
          await writeFile(filePath, statements.join('\n'), 'utf8')
        } finally {
          await client.end()
        }
      }
      const target = tableName ? `表“${tableName}”` : `数据库“${databaseName}”`
      return { success: true, message: `${target}${includeData ? '结构和数据' : '结构'}导出成功` }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async test(input: CreateConnectionInput): Promise<ConnectionActionResult> {
    const validationMessage = this.validate(input)
    if (validationMessage) return { success: false, message: validationMessage }

    try {
      await this.readDatabases(input)
      return { success: true, message: '连接成功' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async testUpdate(input: UpdateConnectionInput): Promise<ConnectionActionResult> {
    const existing = this.repository.getById(input.id)
    if (!existing) return { success: false, message: '连接不存在' }
    return this.test({
      ...input,
      password: input.password || existing.password,
      ssh: input.ssh ? {
        ...input.ssh,
        password: input.ssh.password || existing.sshPassword,
        passphrase: input.ssh.passphrase || existing.sshPassphrase
      } : input.ssh
    })
  }

  private async hydrateConnection(connection: StoredConnection): Promise<DatabaseConnection> {
    const color = connection.color || ENGINE_COLORS[connection.engine]
    if (!connection.open) {
      return {
        id: connection.id,
        name: connection.name,
        engine: connection.engine,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        defaultDatabase: connection.defaultDatabase,
        databases: [],
        color,
        connected: false,
        open: false,
        groupId: connection.groupId,
        groupName: connection.groupName,
        ...this.publicSecurity(connection)
      }
    }

    try {
      const databases = await this.readDatabases(connection)
      return {
        id: connection.id,
        name: connection.name,
        engine: connection.engine,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        defaultDatabase: connection.defaultDatabase,
        databases,
        color,
        connected: true,
        open: true,
        groupId: connection.groupId,
        groupName: connection.groupName,
        ...this.publicSecurity(connection)
      }
    } catch (error) {
      return {
        id: connection.id,
        name: connection.name,
        engine: connection.engine,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        defaultDatabase: connection.defaultDatabase,
        databases: [],
        color,
        connected: false,
        open: true,
        groupId: connection.groupId,
        groupName: connection.groupName,
        error: this.errorMessage(error),
        ...this.publicSecurity(connection)
      }
    }
  }

  private async readDatabases(
    connection: StoredConnection | CreateConnectionInput
  ): Promise<DatabaseItem[]> {
    const persistentId = 'id' in connection && typeof connection.id === 'number' ? connection.id : -1
    const persistent = persistentId > 0
    const stored = 'sshEnabled' in connection
      ? connection
      : this.storedInput(connection, persistentId)
    const tunnelKey: string | number = persistent ? stored.id : `test-${Date.now()}-${Math.random()}`
    const runtime = await this.prepareRuntimeConnection(stored, tunnelKey)
    try {
      if (runtime.engine === 'PostgreSQL') return readPostgreSqlDatabases(runtime)
      if (runtime.engine === 'SQLite') return readSqliteDatabases(runtime)
      const client = await createConnection(this.mysqlOptions(runtime))
      try {
      const [databaseRows] = await client.query<DatabaseRow[]>(
        `SELECT
          SCHEMA_NAME AS databaseName,
          DEFAULT_CHARACTER_SET_NAME AS charset,
          DEFAULT_COLLATION_NAME AS collation
        FROM information_schema.SCHEMATA
        ORDER BY SCHEMA_NAME`
      )
      const [tableRows] = await client.query<TableRow[]>(`
        SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, COALESCE(TABLE_COMMENT, '') AS comment
        FROM information_schema.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `)
      const optionalQuery = async <Row extends RowDataPacket>(sql: string): Promise<Row[]> => {
        try {
          const [rows] = await client.query<Row[]>(sql)
          return rows
        } catch (error) {
          console.warn('读取可选数据库元数据失败：', this.errorMessage(error))
          return []
        }
      }

      const viewRows = await optionalQuery<ObjectRow>(`
        SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS objectName
        FROM information_schema.VIEWS
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `)
      const procedureRows = await optionalQuery<ObjectRow>(`
        SELECT ROUTINE_SCHEMA AS databaseName, ROUTINE_NAME AS objectName
        FROM information_schema.ROUTINES
        WHERE ROUTINE_TYPE = 'PROCEDURE'
        ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
      `)
      const columnRows = await optionalQuery<TableObjectRow>(`
        SELECT
          TABLE_SCHEMA AS databaseName,
          TABLE_NAME AS tableName,
          COLUMN_NAME AS objectName
        FROM information_schema.COLUMNS
        ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
      `)
      const indexRows = await optionalQuery<TableObjectRow>(`
        SELECT DISTINCT
          TABLE_SCHEMA AS databaseName,
          TABLE_NAME AS tableName,
          INDEX_NAME AS objectName
        FROM information_schema.STATISTICS
        ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME
      `)
      const foreignKeyRows = await optionalQuery<TableObjectRow>(`
        SELECT DISTINCT
          TABLE_SCHEMA AS databaseName,
          TABLE_NAME AS tableName,
          CONCAT(CONSTRAINT_NAME, ' → ', REFERENCED_TABLE_SCHEMA, '.', REFERENCED_TABLE_NAME) AS objectName
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY databaseName, tableName, objectName
      `)
      const checkRows = await optionalQuery<TableObjectRow>(`
        SELECT
          CONSTRAINT_SCHEMA AS databaseName,
          TABLE_NAME AS tableName,
          CONSTRAINT_NAME AS objectName
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_TYPE = 'CHECK'
        ORDER BY CONSTRAINT_SCHEMA, TABLE_NAME, CONSTRAINT_NAME
      `)
      const triggerRows = await optionalQuery<TableObjectRow>(`
        SELECT
          TRIGGER_SCHEMA AS databaseName,
          EVENT_OBJECT_TABLE AS tableName,
          TRIGGER_NAME AS objectName
        FROM information_schema.TRIGGERS
        ORDER BY TRIGGER_SCHEMA, EVENT_OBJECT_TABLE, TRIGGER_NAME
      `)

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

      const columnsByTable = tableObjects(columnRows)
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

      return databaseRows.map((database) => ({
        name: database.databaseName,
        charset: database.charset,
        collation: database.collation,
        tables: tablesByDatabase.get(database.databaseName) ?? [],
        views: viewsByDatabase.get(database.databaseName) ?? [],
        functions: [],
        procedures: proceduresByDatabase.get(database.databaseName) ?? [],
        indexes: [],
        triggers: []
      }))
      } finally {
        await client.end()
      }
    } finally {
      if (!persistent) sshTunnelManager.closeTunnel(tunnelKey)
    }
  }

  private validate(input: CreateConnectionInput): string | null {
    if (!input.name.trim()) return '请输入连接名称'
    if (!input.host.trim()) return input.engine === 'SQLite' ? '请输入 SQLite 数据库文件路径' : '请输入主机地址'
    if (input.engine !== 'SQLite' && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) return '端口必须在 1 至 65535 之间'
    if (input.engine !== 'SQLite' && !input.username.trim()) return '请输入用户名'
    if (input.engine === 'PostgreSQL' && !input.defaultDatabase.trim()) return '请输入默认数据库'
    if (input.ssh?.enabled) {
      if (!input.ssh.host.trim()) return '请输入 SSH 主机'
      if (!Number.isInteger(input.ssh.port) || input.ssh.port < 1 || input.ssh.port > 65535) return 'SSH 端口必须在 1 至 65535 之间'
      if (!input.ssh.username.trim()) return '请输入 SSH 用户名'
      if (input.ssh.authType === 'privateKey' && !input.ssh.privateKeyPath?.trim()) return '请选择 SSH 私钥文件'
    }
    return null
  }

  private validateDatabaseDefinition(input: DatabaseDefinitionInput): string | null {
    if (!input.name.trim()) return '请输入数据库名称'
    if (input.name.length > 64) return '数据库名称不能超过 64 个字符'
    if (!/^[A-Za-z0-9_]+$/.test(input.charset)) return '字符集格式不正确'
    if (!/^[A-Za-z0-9_]+$/.test(input.collation)) return '排序规则格式不正确'
    return null
  }

  private quoteIdentifier(identifier: string): string {
    return `\`${identifier.replaceAll('`', '``')}\``
  }

  private quoteIdentifierForEngine(engine: StoredConnection['engine'], identifier: string): string {
    return engine === 'PostgreSQL'
      ? `"${identifier.replaceAll('"', '""')}"`
      : this.quoteIdentifier(identifier)
  }

  private buildColumnDefinition(column: TableColumnDefinition): string | null {
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
      this.quoteIdentifier(column.name),
      typeSql,
      column.notNull || column.primaryKey ? 'NOT NULL' : 'NULL'
    ]
    if (column.defaultValue !== undefined) {
      if (column.defaultValue === null) {
        if (!column.notNull && !column.primaryKey) parts.push('DEFAULT NULL')
      } else if (/^(CURRENT_TIMESTAMP(?:\(\d\))?|NULL)$/i.test(column.defaultValue)) {
        parts.push(`DEFAULT ${column.defaultValue}`)
      } else {
        parts.push(`DEFAULT ${this.quoteString(String(column.defaultValue))}`)
      }
    }
    if (column.autoIncrement || column.extra?.toLowerCase().includes('auto_increment')) parts.push('AUTO_INCREMENT')
    const onUpdate = column.extra?.match(/on update\s+(CURRENT_TIMESTAMP(?:\(\d\))?)/i)?.[1]
    if (onUpdate) parts.push(`ON UPDATE ${onUpdate}`)
    if (column.comment) parts.push(`COMMENT ${this.quoteString(column.comment)}`)
    return parts.join(' ')
  }

  private quoteString(value: string): string {
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
  }

  private quotePortableString(value: string): string {
    return `'${value.replaceAll("'", "''")}'`
  }

  private mysqlDumpValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number' || typeof value === 'bigint') return String(value)
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
    const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value)
    return this.quoteString(text)
  }

  private async executeDatabaseStatement(
    connectionId: number,
    sql: string,
    successMessage: string
  ): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    let client: Awaited<ReturnType<typeof createConnection>> | null = null
    try {
      client = await createConnection(this.mysqlOptions(connection))
      await client.query(sql)
      return { success: true, message: successMessage }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    } finally {
      if (client) await client.end()
    }
  }

  private errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return '数据库连接失败'
    if ('code' in error) {
      const code = String(error.code)
      if (code === 'ECONNREFUSED') return '无法连接数据库，请确认数据库服务已启动且主机、端口正确'
      if (code === 'ER_ACCESS_DENIED_ERROR') return '用户名或密码错误'
      if (code === '28P01') return 'PostgreSQL 用户名或密码错误'
      if (code === '3D000') return 'PostgreSQL 默认数据库不存在'
      if (code === 'SQLITE_CANTOPEN') return '无法打开 SQLite 数据库文件，请检查路径和文件权限'
      if (code === 'ENOTFOUND') return '找不到数据库主机'
    }
    return error.message || '数据库连接失败'
  }
}
