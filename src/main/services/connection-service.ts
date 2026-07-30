import type { RowDataPacket } from 'mysql2/promise'
import { createPool } from 'mysql2/promise'
import type {
  ConnectionActionResult,
  ConnectionEnvironment,
  ConnectionGroup,
  CopyTableInput,
  CreateTableInput,
  CreateConnectionInput,
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
  UpdateDatabaseInput,
  UpdateTableInput,
  UpdateConnectionInput,
  ConnectionProtocol,
  ProcessItem,
  ProcessListResult,
  KillProcessResult
} from '../../shared/connections'
import { ConnectionRepository } from '../database/connection-repository'
import type { StoredConnection } from '../database/connection-repository'
import { buildSslConfig } from './ssl-helper'
import { sshTunnelManager } from './ssh-tunnel-manager'
import { splitSqlStatements } from './sql-statement-splitter'
import { transactionManager } from './transaction-manager'
import {
  closePostgresPools,
  readPostgreSqlDatabases,
  readPostgreSqlDatabaseDetail,
  executePostgreSqlQuery,
  executePostgreSqlFile,
  readPostgreSqlTableData,
  updatePostgreSqlRow,
  deletePostgreSqlRow,
  getPostgreSqlTableDefinition,
  updatePostgreSqlTableComment,
  fetchMorePostgreSqlRows,
  createPostgreSqlPortableTable
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
  updateSqliteTable,
  fetchMoreSqliteRows,
  createSqlitePortableTable
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
  getMysqlPool,
  destroyMysqlPools,
  getMysqlEditableMetadata,
  listMysqlCharsets,
  buildColumnDefinition
} from './adapters/mysql-adapter'
import {
  isSelectQuery,
  applyLimit,
  applyLimitOffset,
  QUERY_ROW_LIMIT,
  getCursor,
  createCursor,
  updateCursorOffset,
  deleteCursor,
  deleteCursorsForConnection
} from './query-cursor-manager'
import { dbWorkerClosePools, dbWorkerMysqlQuery } from './db-query-runtime'

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

const MYSQL_COLOR = '#f3a83b'
const isMysqlFamily = (engine: string): boolean => engine === 'MySQL' || engine === 'MariaDB' || engine === 'TiDB'
const ENGINE_COLORS: Partial<Record<ConnectionProtocol, string>> = {
  MySQL: MYSQL_COLOR,
  PostgreSQL: '#336791',
  SQLite: '#4c9ac0',
  'SQL Server': '#cc2929',
  MongoDB: '#47A248',
  ClickHouse: '#ffcc00',
  Redis: '#dc382d',
  '达梦': '#0072c6',
  '人大金仓': '#e60012',
  SSH: '#818cf8'
}

export class ConnectionService {
  private heartbeatTimer: NodeJS.Timeout | null = null

  constructor(public readonly repository: ConnectionRepository) {
    this.startHeartbeatTimer()
  }

  /**
   * 关闭一个保存连接关联的全部运行时资源。
   * 编辑连接前必须先清理，否则连接测试会命中旧地址、旧密码或旧 TLS 配置的缓存。
   */
  private async closeRuntimeResources(connection: StoredConnection): Promise<void> {
    const workerPrefix = connection.id > 0
      ? `id:${connection.id}`
      : `${connection.host}:${connection.port}:${connection.username}`
    sshTunnelManager.closeTunnel(connection.id)
    deleteCursorsForConnection(connection.id)
    const closers: Array<Promise<unknown>> = [destroyMysqlPools(connection.id)]
    if (connection.engine === 'MySQL' || connection.engine === 'MariaDB' || connection.engine === 'TiDB') {
      closers.push(dbWorkerClosePools(workerPrefix, 'mysql'))
    }
    if (connection.engine === 'PostgreSQL') {
      closePostgresPools(connection)
      closers.push(dbWorkerClosePools(workerPrefix, 'pg'))
    }
    if (connection.engine === '达梦') closers.push(closeDmPools(connection))
    if (connection.engine === '人大金仓') closers.push(closeKbPools(connection))
    if (connection.engine === 'SQLite') closers.push(closeSqliteHandle(connection))
    if (connection.engine === 'DuckDB') closers.push(closeDuckDbHandle(connection))
    if (connection.engine === 'SQL Server') closers.push(closeMssqlPools(connection))
    if (connection.engine === 'MongoDB') closers.push(closeMongoClients(connection))
    if (connection.engine === 'ClickHouse') closers.push(closeChClient(connection))
    if (connection.engine === 'Redis') closers.push(closeRedisClient(connection))
    await Promise.allSettled(closers)
  }

  updateSortOrders(orders: Array<{ id: number; sortOrder: number }>): ConnectionActionResult {
    try {
      this.repository.updateSortOrders(orders)
      return { success: true, message: '操作成功' }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async exportConfig(options?: {
    targetPath?: string
    selectedIds?: number[]
    includePasswords?: boolean
  }): Promise<{ success: boolean; message: string; filePath?: string }> {
    try {
      let connections = this.repository.list()
      const groups = this.repository.listGroups()

      if (options?.selectedIds?.length) {
        const idSet = new Set(options.selectedIds)
        connections = connections.filter((c) => idSet.has(c.id))
      }

      const includePwd = options?.includePasswords === true

      const exportData = {
        app: 'OrbiSQL',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        groups: groups.map((g) => ({ name: g.name, category: g.category })),
        connections: connections.map((c) => ({
          name: c.name,
          engine: c.engine,
          host: c.host,
          port: c.port,
          username: c.username,
          defaultDatabase: c.defaultDatabase,
          password: includePwd && c.savePassword ? c.password : '',
          savePassword: includePwd && c.savePassword,
          color: c.color,
          environment: c.environment,
          groupName: c.groupName,
          sshEnabled: c.sshEnabled,
          sshHost: c.sshHost,
          sshPort: c.sshPort,
          sshUsername: c.sshUsername,
          sshAuthType: c.sshAuthType,
          sshPassword: includePwd ? c.sshPassword : '',
          sshPrivateKeyPath: c.sshPrivateKeyPath,
          sshPassphrase: includePwd ? c.sshPassphrase : '',
          sslEnabled: c.sslEnabled,
          sslRejectUnauthorized: c.sslRejectUnauthorized,
          sslCaPath: c.sslCaPath,
          sslCertPath: c.sslCertPath,
          sslKeyPath: c.sslKeyPath
        }))
      }

      let filePath = options?.targetPath || ''
      if (!filePath) {
        const { dialog } = await import('electron')
        const selected = await dialog.showSaveDialog({
          title: '导出连接配置文件',
          defaultPath: 'orbisql-connections-backup.json',
          filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
        })
        if (selected.canceled || !selected.filePath) {
          return { success: false, message: '已取消导出' }
        }
        filePath = selected.filePath
      }

      const { writeFile } = await import('fs/promises')
      await writeFile(filePath, JSON.stringify(exportData, null, 2), 'utf8')
      return { success: true, message: `成功导出 ${connections.length} 个连接及 ${groups.length} 个分组`, filePath }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async readImportConfigFile(sourcePath?: string): Promise<{
    success: boolean
    message: string
    filePath?: string
    groups?: Array<{ name: string; category?: 'database' | 'ssh' }>
    connections?: Array<CreateConnectionInput & { groupName?: string }>
  }> {
    try {
      let filePath = sourcePath || ''
      if (!filePath) {
        const { dialog } = await import('electron')
        const selected = await dialog.showOpenDialog({
          title: '选择导入的连接配置文件',
          properties: ['openFile'],
          filters: [{ name: 'JSON 配置文件', extensions: ['json'] }]
        })
        if (selected.canceled || !selected.filePaths[0]) {
          return { success: false, message: '已取消导入' }
        }
        filePath = selected.filePaths[0]
      }

      const { readFile } = await import('fs/promises')
      const content = await readFile(filePath, 'utf8')
      const data = JSON.parse(content) as {
        groups?: Array<{ name: string; category?: 'database' | 'ssh' }>
        connections?: Array<CreateConnectionInput & { groupName?: string }>
      }

      if (!Array.isArray(data.connections)) {
        return { success: false, message: '导入文件格式不合法，未找到有效 connections 列表' }
      }

      return {
        success: true,
        message: '解析配置文件成功',
        filePath,
        groups: data.groups || [],
        connections: data.connections || []
      }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  async importConfig(options?: {
    filePath?: string
    sourcePath?: string
    groups?: Array<{ name: string; category?: 'database' | 'ssh' }>
    connections?: Array<CreateConnectionInput & { groupName?: string }>
  }): Promise<{ success: boolean; message: string }> {
    try {
      let connections = options?.connections
      let groups = options?.groups

      if (!connections) {
        const readRes = await this.readImportConfigFile(options?.filePath || options?.sourcePath)
        if (!readRes.success || !readRes.connections) {
          return { success: false, message: readRes.message }
        }
        connections = readRes.connections
        groups = readRes.groups
      }

      const existingGroups = this.repository.listGroups()
      const groupMap = new Map<string, number>(existingGroups.map((g) => [g.name, g.id]))

      if (Array.isArray(groups)) {
        for (const g of groups) {
          if (g.name && !groupMap.has(g.name)) {
            const res = this.createConnectionGroup(g.name, g.category || 'database')
            if (res.success) {
              const updatedGroups = this.repository.listGroups()
              const created = updatedGroups.find((item) => item.name === g.name)
              if (created) groupMap.set(created.name, created.id)
            }
          }
        }
      }

      const existingConnections = this.repository.list()
      const existingNames = new Set(existingConnections.map((c) => c.name))
      let importedCount = 0

      for (const conn of connections) {
        if (!conn.name || !conn.engine) continue
        let uniqueName = conn.name
        let suffix = 1
        while (existingNames.has(uniqueName)) {
          uniqueName = `${conn.name} (${suffix++})`
        }
        existingNames.add(uniqueName)

        const groupId = conn.groupName && groupMap.has(conn.groupName) ? groupMap.get(conn.groupName)! : null
        this.repository.create({
          name: uniqueName,
          engine: conn.engine,
          host: conn.host || 'localhost',
          port: conn.port || 3306,
          username: conn.username || 'root',
          password: conn.password || '',
          defaultDatabase: conn.defaultDatabase || '',
          savePassword: Boolean(conn.savePassword),
          color: conn.color,
          environment: conn.environment ?? null,
          groupId,
          ssh: conn.ssh,
          ssl: conn.ssl
        })
        importedCount++
      }

      return { success: true, message: `已成功导入 ${importedCount} 个连接配置` }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }

  private startHeartbeatTimer(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      void this.performHeartbeat()
    }, 45000)
  }

  private async performHeartbeat(): Promise<void> {
    const connections = this.repository.list()
    const openConns = connections.filter((c) => c.open)
    for (const conn of openConns) {
      try {
        if (conn.engine === 'MySQL' || conn.engine === 'MariaDB' || conn.engine === 'TiDB') {
          const pool = getMysqlPool(conn)
          await pool.query('SELECT 1;')
        }
      } catch (err) {
        console.warn(`[ConnectionService] 心跳检测连接 ${conn.name} (ID: ${conn.id}) 失败:`, err)
      }
    }
  }

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
      environment: input.environment ?? null,
      groupId: input.groupId ?? null,
      groupName: '',
      sortOrder: 0,
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

  async list(): Promise<DatabaseConnection[]> {
    return Promise.all(this.repository.list().map((connection) => this.hydrateConnection(connection)))
  }

  async getOne(id: number): Promise<DatabaseConnection | null> {
    const connection = this.repository.getById(id)
    if (!connection) return null
    return this.hydrateConnection(connection)
  }

  listConnectionGroups(): ConnectionGroup[] { return this.repository.listGroups() }

  createConnectionGroup(name: string, category: 'database' | 'ssh' = 'database'): ConnectionActionResult {
    const normalized = name.trim()
    if (!normalized) return { success: false, message: '请输入分组名称' }
    if (normalized.length > 30) return { success: false, message: '分组名称不能超过 30 个字符' }
    try { this.repository.createGroup(normalized, category); return { success: true, message: '分组已创建' } }
    catch (error) { return { success: false, message: this.errorMessage(error) } }
  }

  deleteConnectionGroup(id: number): ConnectionActionResult {
    try { this.repository.deleteGroup(id); return { success: true, message: '分组已删除，原连接已移至未分组' } }
    catch (error) { return { success: false, message: this.errorMessage(error) } }
  }

  renameConnectionGroup(id: number, name: string): ConnectionActionResult {
    const normalized = name.trim()
    if (!normalized) return { success: false, message: '请输入分组名称' }
    if (normalized.length > 30) return { success: false, message: '分组名称不能超过 30 个字符' }
    const groups = this.repository.listGroups()
    if (!groups.some((g) => g.id === id)) return { success: false, message: '分组不存在' }
    try {
      this.repository.renameGroup(id, normalized)
      return { success: true, message: '分组已重命名' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  setConnectionGroup(connectionId: number, groupId: number | null): ConnectionActionResult {
    const conn = this.repository.getById(connectionId)
    if (!conn) return { success: false, message: '连接不存在' }
    if (groupId != null && !this.repository.listGroups().some((group) => group.id === groupId)) return { success: false, message: '分组不存在' }
    if (groupId != null) {
      const group = this.repository.listGroups().find((g) => g.id === groupId)
      if (group) {
        const isSshEngine = conn.engine === 'SSH'
        const expectedCategory = isSshEngine ? 'ssh' : 'database'
        if (group.category !== expectedCategory) {
          return { success: false, message: '连接类型与分组类型不匹配' }
        }
      }
    }
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
      const newId = this.repository.create(input)
      return { success: true, message: '连接已保存', connectionId: newId }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async updateColor(id: number, color: string): Promise<ConnectionActionResult> {
    try {
      this.repository.updateColor(id, color)
      return { success: true, message: '连接颜色已更新' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async updateEnvironment(id: number, environment: ConnectionEnvironment | null): Promise<ConnectionActionResult> {
    try {
      this.repository.updateEnvironment(id, environment)
      return { success: true, message: environment ? `环境标识已更新为 ${environment}` : '环境标识已清除' }
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
      await this.closeRuntimeResources(existing)
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
    console.warn('[ConnectionService] open() called, id =', id)
    try {
      const connection = this.repository.getById(id)
      if (!connection) return { success: false, message: '连接不存在' }
      console.warn('[ConnectionService] open() connection loaded', { savePassword: connection.savePassword, hasPassword: !!connection.password })
      if (connection.savePassword && !connection.password) {
        console.error('[ConnectionService] 密码解密失败，拒绝以空密码建立连接')
        return { success: false, message: '密码解密失败，请重新保存连接密码后再试' }
      }
      const databases = await this.readDatabases(connection, { light: true })
      this.repository.replaceDatabaseStats(connection, databases)
      this.repository.setOpen(id, true)
      console.warn('[ConnectionService] open() success')
      return { success: true, message: '连接已打开' }
    } catch (error) {
      console.error('[ConnectionService] open() caught error', error)
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async close(id: number): Promise<ConnectionActionResult> {
    try {
      const connection = this.repository.getById(id)
      if (!connection) return { success: false, message: '连接不存在' }
      this.repository.setOpen(id, false)
      await this.closeRuntimeResources(connection)
      return { success: true, message: '连接已关闭' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  duplicate(id: number): ConnectionActionResult {
    try {
      const newId = this.repository.duplicate(id)
      return { success: true, message: '连接已复制', connectionId: newId }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async delete(id: number): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(id)
    if (!connection) return { success: false, message: '连接不存在' }
    this.repository.delete(id)
    await this.closeRuntimeResources(connection)
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
        await executeSqliteFile(connection, sql)
        return { success: true, message: 'SQL 文件执行成功' }
      } catch (error) {
        return { success: false, message: this.errorMessage(error) }
      }
    }
    if (connection.engine === 'DuckDB') {
      try {
        await executeDuckDbFile(connection, sql)
        return { success: true, message: 'SQL 文件执行成功' }
      } catch (error) {
        return { success: false, message: this.errorMessage(error) }
      }
    }
    if (connection.engine === 'SQL Server') {
      try {
        await executeMssqlFile(connection, databaseName || '', sql)
        return { success: true, message: 'SQL 文件执行成功' }
      } catch (error) {
        return { success: false, message: this.errorMessage(error) }
      }
    }

    const pool = getMysqlPool(connection, databaseName, true)
    try {
      await pool.query(sql)
      return { success: true, message: 'SQL 文件执行成功' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async createDatabase(input: DatabaseDefinitionInput): Promise<ConnectionActionResult> {
    const validation = this.validateDatabaseDefinition(input)
    if (validation) return { success: false, message: validation }
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'SQLite') return { success: false, message: 'SQLite 连接即数据库文件，请通过新建连接添加其他文件' }
    if (connection.engine === 'DuckDB') return { success: false, message: 'DuckDB 连接即数据库文件，请通过新建连接添加其他文件' }
    if (connection.engine === 'PostgreSQL') {
      const result = await this.executeSql(input.connectionId, `CREATE DATABASE ${this.quoteIdentifierForEngine('PostgreSQL', input.name)} ENCODING 'UTF8'`)
      if (result.success) await this.refreshPersistedDatabaseStats(connection)
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
    if (connection.engine === 'DuckDB') return { success: false, message: 'DuckDB 数据库名称由文件名决定' }
    if (connection.engine === 'PostgreSQL') {
      if (input.name === input.currentName) return { success: true, message: '数据库没有变化' }
      const result = await this.executeSql(input.connectionId, `ALTER DATABASE ${this.quoteIdentifierForEngine('PostgreSQL', input.currentName)} RENAME TO ${this.quoteIdentifierForEngine('PostgreSQL', input.name)}`)
      if (result.success) await this.refreshPersistedDatabaseStats(connection)
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
    if (connection.engine === 'DuckDB') return { success: false, message: '为避免误删文件，请在连接列表中删除 DuckDB 连接' }
    if (connection.engine === 'PostgreSQL') {
      const result = await this.executeSql(connectionId, `DROP DATABASE ${this.quoteIdentifierForEngine('PostgreSQL', databaseName)}`)
      if (result.success) this.repository.removeDatabaseStats(connectionId, databaseName)
      return result.success ? { success: true, message: '数据库已删除' } : result
    }
    const result = await this.executeDatabaseStatement(
      connectionId,
      `DROP DATABASE ${this.quoteIdentifier(databaseName)}`,
      '数据库已删除'
    )
    if (result.success) this.repository.removeDatabaseStats(connectionId, databaseName)
    return result
  }

  async executeQuery(connectionId: number, databaseName: string, sql: string, sessionId?: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) return { success: false, message: '请输入 SQL 语句' }
    const storedForStats = this.repository.getById(connectionId)
    const recordResult = async (result: QueryExecutionResult, queryCount: number): Promise<QueryExecutionResult> => {
      if (storedForStats) {
        try {
          this.repository.recordQueryRun({
            connectionId,
            connectionName: storedForStats.name,
            engine: storedForStats.engine,
            databaseName,
            sql,
            success: result.success,
            queryCount: result.queryCount ?? queryCount,
            affectedRows: result.affectedRows,
            durationMs: result.durationMs,
            errorMessage: result.success ? '' : result.message
          })
        } catch (error) {
          console.warn('记录工作台查询统计失败：', this.errorMessage(error))
        }
        await this.refreshStatsForSql(storedForStats, databaseName, sql, result.success)
      }
      return result
    }
    if (sessionId && transactionManager.has(sessionId)) {
      try {
        const result = await transactionManager.execute(sessionId, sql)
        return await recordResult(result, Math.max(1, result.queryCount ?? splitSqlStatements(sql).length))
      } catch (error) {
        return await recordResult({ success: false, message: this.errorMessage(error), queryCount: 0, successCount: 0, errorCount: 1 }, 1)
      }
    }
    const statements = splitSqlStatements(sql)
    if (statements.length <= 1) {
      const result = await this.executeSingleQuery(connectionId, databaseName, statements[0] ?? sql)
      return await recordResult(result, 1)
    }
    const stored = this.repository.getById(connectionId)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    try {
      const connection = stored.sshEnabled && !sshTunnelManager.getEndpoint(connectionId)
        ? await this.prepareRuntimeConnection(stored, connectionId)
        : stored
      const result = await transactionManager.executeBatch(connection, databaseName, sql)
      return await recordResult(result, statements.length)
    } catch (error) {
      return await recordResult({ success: false, message: this.errorMessage(error), queryCount: statements.length, successCount: 0, errorCount: 1 }, statements.length)
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
      if (connection.engine === '达梦') return await executeDmQuery(connection, databaseName, sql)
      if (connection.engine === '人大金仓') return await executeKbQuery(connection, databaseName, sql)
      if (connection.engine === 'SQLite') return await executeSqliteQuery(connection, sql)
      if (connection.engine === 'DuckDB') return await executeDuckDbQuery(connection, sql)
      if (connection.engine === 'SQL Server') return await executeMssqlQuery(connection, databaseName, sql)
      if (connection.engine === 'MongoDB') return await executeMongoQuery(connection, databaseName, sql)
      if (connection.engine === 'ClickHouse') return await executeChQuery(connection, databaseName, sql)
      if (connection.engine === 'Redis') return await executeRedisCommand(connection, databaseName, sql)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }

    const poolKey = connection.id > 0 ? `id:${connection.id}` : `${connection.host}:${connection.port}:${connection.username}`
    const workerConfig = { id: connection.id, host: connection.host, port: connection.port, username: connection.username, password: connection.password, sslEnabled: connection.sslEnabled, sslRejectUnauthorized: connection.sslRejectUnauthorized, sslCaPath: connection.sslCaPath, sslCertPath: connection.sslCertPath, sslKeyPath: connection.sslKeyPath }
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
      return { success: false, message: this.errorMessage(error), ...executionStats(false) }
    }
  }

  /** P1-4: 通过游标获取更多结果行 */
  async fetchMoreRows(connectionId: number, databaseName: string, cursorId: string): Promise<{
    success: boolean
    message: string
    rows?: Array<Record<string, unknown>>
    done?: boolean
    offset?: number
    totalRows?: number
  }> {
    const cursor = getCursor(cursorId)
    if (!cursor) return { success: false, message: '游标不存在或已过期，请重新执行查询' }
    if (cursor.connectionId != null && cursor.connectionId !== connectionId) {
      return { success: false, message: '游标与当前连接不匹配，请重新执行查询' }
    }
    const stored = this.repository.getById(connectionId)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    const sameEngine = cursor.engine === stored.engine || (cursor.engine === 'MySQL' && isMysqlFamily(stored.engine))
    if (!sameEngine) return { success: false, message: '游标与当前数据库类型不匹配，请重新执行查询' }
    if (cursor.databaseName && databaseName && cursor.databaseName !== databaseName) {
      return { success: false, message: '游标与当前数据库不匹配，请重新执行查询' }
    }
    let connection = stored
    if (stored.sshEnabled && !sshTunnelManager.getEndpoint(connectionId)) {
      try { connection = await this.prepareRuntimeConnection(stored, connectionId) }
      catch (error) { return { success: false, message: this.errorMessage(error) } }
    }
    try {
      let result: { rows: Array<Record<string, unknown>>; done: boolean }
      if (cursor.engine === 'SQLite') {
        result = await fetchMoreSqliteRows(connection, cursor)
      } else if (cursor.engine === 'DuckDB') {
        result = await fetchMoreDuckDbRows(connection, cursor)
      } else if (cursor.engine === 'SQL Server') {
        result = await fetchMoreMssqlRows(connection, databaseName, cursor)
      } else if (cursor.engine === 'MongoDB') {
        result = await fetchMoreMongoRows(connection, databaseName, cursor)
      } else if (cursor.engine === 'ClickHouse') {
        result = await fetchMoreChRows(connection, databaseName, cursor)
      } else if (cursor.engine === '达梦') {
        result = await fetchMoreDmRows(connection, databaseName, cursor)
      } else if (cursor.engine === '人大金仓') {
        result = await fetchMoreKbRows(connection, databaseName, cursor)
      } else if (cursor.engine === 'PostgreSQL') {
        result = await fetchMorePostgreSqlRows(connection, databaseName, cursor)
      } else {
        // MySQL - 通过 Worker 执行
        const poolKey = connection.id > 0 ? `id:${connection.id}` : `${connection.host}:${connection.port}:${connection.username}`
        const workerConfig = { id: connection.id, host: connection.host, port: connection.port, username: connection.username, password: connection.password, sslEnabled: connection.sslEnabled, sslRejectUnauthorized: connection.sslRejectUnauthorized, sslCaPath: connection.sslCaPath, sslCertPath: connection.sslCertPath, sslKeyPath: connection.sslKeyPath }
        const limitedSql = applyLimitOffset(cursor.sql, QUERY_ROW_LIMIT, cursor.offset)
        const queryResult = await dbWorkerMysqlQuery(poolKey, workerConfig, databaseName, limitedSql)
        const mappedRows = queryResult.type === 'rows' ? queryResult.rows : []
        result = { rows: mappedRows, done: mappedRows.length < QUERY_ROW_LIMIT }
        updateCursorOffset(cursor.id, cursor.offset + mappedRows.length)
        if (result.done) deleteCursor(cursor.id)
      }
      return {
        success: true,
        message: `获取 ${result.rows.length} 行${result.done ? '，已全部加载' : ''}`,
        rows: result.rows,
        done: result.done,
        offset: cursor.offset,
        totalRows: cursor.totalRows
      }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async updateQueryRow(input: QueryUpdateRowInput): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    if (!Object.keys(input.changes).length) return { success: false, message: '没有需要保存的修改' }

    try {
      if (connection.engine === 'PostgreSQL') return await updatePostgreSqlRow(connection, input)
      if (connection.engine === '达梦') return await updateDmRow(connection, input.databaseName, input)
      if (connection.engine === '人大金仓') return await updateKbRow(connection, input.databaseName, input)
      if (connection.engine === 'SQLite') return await updateSqliteRow(connection, input)
      if (connection.engine === 'DuckDB') return await updateDuckDbRow(connection, input)
      if (connection.engine === 'SQL Server') return await updateMssqlRow(connection, input.databaseName, input)
      if (connection.engine === 'MongoDB') return await updateMongoRow(connection, input.databaseName, input)
      if (connection.engine === 'ClickHouse') return await updateChRow(connection, input.databaseName, input)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }

    const pool = getMysqlPool(connection, input.databaseName)
    try {
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

      const setSql = changeColumns.map((column) => `${this.quoteIdentifier(column)} = ?`).join(', ')
      const whereSql = primaryKeys.map((column) => `${this.quoteIdentifier(column)} <=> ?`).join(' AND ')
      const values = [
        ...changeColumns.map((column) => input.changes[column]),
        ...primaryKeys.map((column) => input.primaryKeyValues[column])
      ]
      const [result] = await pool.query(
        `UPDATE ${this.quoteIdentifier(input.tableName)} SET ${setSql} WHERE ${whereSql} LIMIT 1`,
        values
      )
      const affectedRows = 'affectedRows' in result ? Number(result.affectedRows) : 0
      return { success: true, message: affectedRows ? '数据已保存' : '数据没有变化' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async deleteQueryRow(input: QueryDeleteRowInput): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    try {
      if (connection.engine === 'PostgreSQL') return await deletePostgreSqlRow(connection, input)
      if (connection.engine === '达梦') return await deleteDmRow(connection, input.databaseName, input)
      if (connection.engine === '人大金仓') return await deleteKbRow(connection, input.databaseName, input)
      if (connection.engine === 'SQLite') return await deleteSqliteRow(connection, input)
      if (connection.engine === 'DuckDB') return await deleteDuckDbRow(connection, input)
      if (connection.engine === 'SQL Server') return await deleteMssqlRow(connection, input.databaseName, input)
      if (connection.engine === 'MongoDB') return await deleteMongoRow(connection, input.databaseName, input)
      if (connection.engine === 'ClickHouse') return await deleteChRow(connection, input.databaseName, input)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
    const pool = getMysqlPool(connection, input.databaseName)
    try {
      const [columnRows] = await pool.query<EditableColumnRow[]>(`
        SELECT COLUMN_NAME AS columnName, COLUMN_KEY AS columnKey
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      `, [input.databaseName, input.tableName])
      const primaryKeys = columnRows.filter((column) => column.columnKey === 'PRI').map((column) => column.columnName)
      if (!primaryKeys.length || primaryKeys.some((key) => !(key in input.primaryKeyValues))) {
        return { success: false, message: '缺少完整主键，无法安全删除数据' }
      }
      const whereSql = primaryKeys.map((column) => `${this.quoteIdentifier(column)} <=> ?`).join(' AND ')
      const [result] = await pool.query(
        `DELETE FROM ${this.quoteIdentifier(input.tableName)} WHERE ${whereSql} LIMIT 1`,
        primaryKeys.map((column) => input.primaryKeyValues[column])
      )
      const affectedRows = 'affectedRows' in result ? Number(result.affectedRows) : 0
      return affectedRows
        ? { success: true, message: '数据已删除' }
        : { success: false, message: '未找到该数据，可能已被修改或删除' }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
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
      if (connection.engine === '达梦') return await readDmTableData(connection, databaseName, tableName, safeLimit, safeOffset, filter)
      if (connection.engine === '人大金仓') return await readKbTableData(connection, databaseName, tableName, safeLimit, safeOffset, filter)
      if (connection.engine === 'SQLite') return await readSqliteTableData(connection, tableName, safeLimit, safeOffset, filter)
      if (connection.engine === 'DuckDB') return await readDuckDbTableData(connection, tableName, safeLimit, safeOffset, filter)
      if (connection.engine === 'SQL Server') return await readMssqlTableData(connection, databaseName, tableName, safeLimit, safeOffset, filter)
      if (connection.engine === 'MongoDB') return await readMongoTableData(connection, databaseName, tableName, safeLimit, safeOffset, filter)
      if (connection.engine === 'ClickHouse') return await readChTableData(connection, databaseName, tableName, safeLimit, safeOffset, filter)
      if (connection.engine === 'Redis') return await readRedisTableData(connection, databaseName, tableName, safeLimit, safeOffset, filter)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
    let whereSql = ''
    if (filter?.column) {
      try {
        const pool = getMysqlPool(connection, databaseName)
        const [columns] = await pool.query<EditableColumnRow[]>(`
          SELECT COLUMN_NAME AS columnName, COLUMN_KEY AS columnKey
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        `, [databaseName, tableName])
        if (!columns.some((column) => column.columnName === filter.column)) {
          return { success: false, message: '筛选字段不存在' }
        }
      } catch (error) {
        return { success: false, message: this.errorMessage(error) }
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
      const command = connection.engine === 'SQLite' || connection.engine === 'DuckDB' ? 'DELETE FROM' : 'TRUNCATE TABLE'
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

    try {
      if (connection.engine === 'MySQL' || connection.engine === 'MariaDB' || connection.engine === 'TiDB') {
        const pool = getMysqlPool(connection, targetDb)
        const srcFull = `${this.quoteIdentifier(input.databaseName)}.${this.quoteIdentifier(input.sourceTableName)}`
        const tgtFull = `${this.quoteIdentifier(targetDb)}.${this.quoteIdentifier(input.targetTableName)}`
        await pool.query(`CREATE TABLE ${tgtFull} LIKE ${srcFull}`)
        if (input.includeData) {
          await pool.query(`INSERT INTO ${tgtFull} SELECT * FROM ${srcFull}`)
        }
        await this.refreshPersistedDatabaseStats(connection, targetDb)
        return {
          success: true,
          message: input.includeData
            ? `已成功复制数据表结构及数据到“${input.targetTableName}”`
            : `已成功复制数据表结构到“${input.targetTableName}”`
        }
      }

      if (connection.engine === 'PostgreSQL') {
        const source = `${this.quoteIdentifier(input.sourceTableName)}`
        const target = `${this.quoteIdentifier(input.targetTableName)}`
        const createSql = input.includeData
          ? `CREATE TABLE ${target} AS TABLE ${source}`
          : `CREATE TABLE ${target} (LIKE ${source} INCLUDING ALL)`
        const created = await executePostgreSqlQuery(connection, targetDb, createSql)
        if (!created.success) return { success: false, message: created.message || '复制数据表失败' }
        await this.refreshPersistedDatabaseStats(connection, targetDb)
        return {
          success: true,
          message: input.includeData
            ? `已成功复制数据表结构及数据到“${input.targetTableName}”`
            : `已成功复制数据表结构到“${input.targetTableName}”`
        }
      }

      if (connection.engine === 'SQLite') {
        const source = `${this.quoteIdentifier(input.sourceTableName)}`
        const target = `${this.quoteIdentifier(input.targetTableName)}`
        const def = await getSqliteTableDefinition(connection, input.sourceTableName)
        if (!def.success || !def.columns) return def
        const ddlRes = await executeSqliteQuery(connection, `SELECT sql FROM sqlite_master WHERE type='table' AND name='${input.sourceTableName}'`)
        let createDdl = ''
        if (ddlRes.rows?.[0]?.sql) {
          createDdl = String(ddlRes.rows[0].sql).replace(new RegExp(`CREATE TABLE ["\`]?${input.sourceTableName}["\`]?`, 'i'), `CREATE TABLE ${target}`)
        } else {
          const colDefs = def.columns.map((c) => `${this.quoteIdentifier(c.name)} ${c.typeDefinition || c.type || 'TEXT'}`).join(', ')
          createDdl = `CREATE TABLE ${target} (${colDefs})`
        }
        const createRes = await executeSqliteQuery(connection, createDdl)
        if (!createRes.success) return { success: false, message: createRes.message || '创建复制表失败' }

        if (input.includeData) {
          await executeSqliteQuery(connection, `INSERT INTO ${target} SELECT * FROM ${source}`)
        }
        await this.refreshPersistedDatabaseStats(connection, targetDb)
        return {
          success: true,
          message: input.includeData
            ? `已成功复制数据表结构及数据到“${input.targetTableName}”`
            : `已成功复制数据表结构到“${input.targetTableName}”`
        }
      }

      return { success: false, message: `暂不支持在 ${connection.engine} 引擎上复制表` }
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async listCharsets(connectionId: number): Promise<DatabaseCharsetResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    if (connection.engine === 'PostgreSQL') return { success: true, message: '编码读取成功', charsets: [{ name: 'UTF8', description: 'Unicode UTF-8', defaultCollation: 'default', collations: ['default'] }] }
    if (connection.engine === 'SQLite') return { success: true, message: '编码读取成功', charsets: [{ name: 'UTF8', description: 'SQLite UTF-8', defaultCollation: 'BINARY', collations: ['BINARY', 'NOCASE', 'RTRIM'] }] }
    if (connection.engine === 'DuckDB') return { success: true, message: '编码读取成功', charsets: [{ name: 'UTF8', description: 'DuckDB UTF-8', defaultCollation: 'NOCASE', collations: ['NOCASE', 'BINARY'] }] }
    if (connection.engine === 'SQL Server') return { success: true, message: '编码读取成功', charsets: [{ name: 'NVARCHAR', description: 'SQL Server Unicode', defaultCollation: 'SQL_Latin1_General_CP1_CI_AS', collations: ['SQL_Latin1_General_CP1_CI_AS', 'Latin1_General_100_CI_AS_SC', 'Chinese_PRC_CI_AS'] }] }
    if (connection.engine === 'MongoDB') return { success: true, message: '编码读取成功', charsets: [{ name: 'UTF8', description: 'MongoDB UTF-8', defaultCollation: 'default', collations: ['default'] }] }
    if (connection.engine === 'ClickHouse') return { success: true, message: '编码读取成功', charsets: [{ name: 'UTF-8', description: 'ClickHouse UTF-8', defaultCollation: 'default', collations: ['default'] }] }
    if (connection.engine === 'Redis') return { success: true, message: '编码读取成功', charsets: [{ name: 'UTF-8', description: 'Redis UTF-8', defaultCollation: 'default', collations: ['default'] }] }
    return listMysqlCharsets(connection)
  }

  async createTable(input: CreateTableInput): Promise<ConnectionActionResult> {
    if (!input.tableName.trim()) return { success: false, message: '请输入表名称' }
    if (!input.columns.length) return { success: false, message: '请至少添加一个字段' }
    if ((input.tableComment ?? '').length > 2048) return { success: false, message: '表注释不能超过 2048 个字符' }
    const connection = this.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'PostgreSQL' || connection.engine === 'SQLite') {
      const result = connection.engine === 'PostgreSQL'
        ? createPostgreSqlPortableTable(connection, input)
        : createSqlitePortableTable(connection, input)
      const resolved = await result
      if (resolved.success) await this.refreshPersistedDatabaseStats(connection, input.databaseName)
      return resolved
    }
    const columnNames = new Set<string>()
    const definitions: string[] = []

    for (const column of input.columns) {
      if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
      if (columnNames.has(column.name)) return { success: false, message: `字段“${column.name}”重复` }
      columnNames.add(column.name)
      const definition = buildColumnDefinition({ ...column, typeDefinition: undefined, extra: undefined })
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
      if (connection.engine === '达梦') return await getDmTableDefinition(connection, databaseName, tableName)
      if (connection.engine === '人大金仓') return await getKbTableDefinition(connection, databaseName, tableName)
      if (connection.engine === 'SQLite') return await getSqliteTableDefinition(connection, tableName)
      if (connection.engine === 'DuckDB') return await getDuckDbTableDefinition(connection, tableName)
      if (connection.engine === 'SQL Server') return await getMssqlTableDefinition(connection, databaseName, tableName)
      if (connection.engine === 'MongoDB') return await getMongoTableDefinition(connection, databaseName, tableName)
      if (connection.engine === 'ClickHouse') return await getChTableDefinition(connection, databaseName, tableName)
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
    const pool = getMysqlPool(connection, databaseName)
    try {
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
    } catch (error) {
      return { success: false, message: this.errorMessage(error) }
    }
  }

  async updateTable(input: UpdateTableInput): Promise<ConnectionActionResult> {
    if (!input.tableName.trim()) return { success: false, message: '请输入表名称' }
    if (!input.columns.length) return { success: false, message: '请至少保留一个字段' }
    if ((input.tableComment ?? '').length > 2048) return { success: false, message: '表注释不能超过 2048 个字符' }
    const targetConnection = this.repository.getById(input.connectionId)
    if (!targetConnection) return { success: false, message: '连接不存在' }
    if (targetConnection.engine === 'SQLite') {
      const result = await updateSqliteTable(targetConnection, input)
      if (result.success) await this.refreshPersistedDatabaseStats(targetConnection, input.databaseName)
      return result
    }
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
      const result = await updatePostgreSqlTableComment(targetConnection, input.databaseName, input.currentTableName, input.tableComment)
      if (result.success) await this.refreshPersistedDatabaseStats(targetConnection, input.databaseName)
      return result
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
      const definition = buildColumnDefinition(safeColumn)
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
    const pool = getMysqlPool(connection, input.databaseName)
    try {
      if (clauses.length) await pool.query(`ALTER TABLE ${this.quoteIdentifier(input.currentTableName)} ${clauses.join(', ')}`)
      if ((current.tableComment ?? '') !== input.tableComment) {
        await pool.query(`ALTER TABLE ${this.quoteIdentifier(input.currentTableName)} COMMENT = ${this.quoteString(input.tableComment)}`)
      }
      if (input.tableName !== input.currentTableName) {
        await pool.query(`RENAME TABLE ${this.quoteIdentifier(input.currentTableName)} TO ${this.quoteIdentifier(input.tableName)}`)
      }
      await this.refreshPersistedDatabaseStats(connection, input.databaseName)
      return { success: true, message: '数据表结构已保存' }
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
    await this.closeRuntimeResources(existing)
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

  private async refreshPersistedDatabaseStats(connection: StoredConnection, databaseName?: string): Promise<void> {
    if (connection.engine === 'SSH' || !connection.open) return
    try {
      const databases = await this.readDatabases(connection, { light: true })
      const scopedDatabases = databaseName ? databases.filter((database) => database.name === databaseName) : databases
      this.repository.replaceDatabaseStats(connection, scopedDatabases.length ? scopedDatabases : databases)
    } catch (error) {
      console.warn('刷新工作台数据库统计失败：', this.errorMessage(error))
    }
  }

  private async refreshStatsForSql(connection: StoredConnection, databaseName: string, sql: string, success: boolean): Promise<void> {
    if (!success) return
    if (!/\b(create|drop|alter|rename|truncate)\s+(table|database|schema)\b/i.test(sql)) return
    const isDatabaseDdl = /\b(create|drop|alter|rename)\s+(database|schema)\b/i.test(sql)
    await this.refreshPersistedDatabaseStats(connection, isDatabaseDdl ? undefined : databaseName)
  }

  private async hydrateConnection(connection: StoredConnection): Promise<DatabaseConnection> {
    const color = connection.color || ENGINE_COLORS[connection.engine] || '#6b7280'
    const environment = connection.environment
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
        environment,
        connected: false,
        open: false,
        groupId: connection.groupId,
        groupName: connection.groupName,
        ...this.publicSecurity(connection)
      }
    }

    try {
      const databases = await this.readDatabases(connection, { light: true })
      this.repository.replaceDatabaseStats(connection, databases)
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
        environment,
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
        environment,
        connected: false,
        open: true,
        groupId: connection.groupId,
        groupName: connection.groupName,
        error: this.errorMessage(error),
        ...this.publicSecurity(connection)
      }
    }
  }

  async readDatabases(
    connection: StoredConnection | CreateConnectionInput,
    options?: ReadDatabasesOptions
  ): Promise<DatabaseItem[]> {
    if (connection.engine === 'SSH') return []
    const persistentId = 'id' in connection && typeof connection.id === 'number' ? connection.id : -1
    const persistent = persistentId > 0
    const stored = 'sshEnabled' in connection
      ? connection
      : this.storedInput(connection, persistentId)
    const tunnelKey: string | number = persistent ? stored.id : `test-${Date.now()}-${Math.random()}`
    const runtime = await this.prepareRuntimeConnection(stored, tunnelKey)
    try {
      if (runtime.engine === 'PostgreSQL') return readPostgreSqlDatabases(runtime, options)
      if (runtime.engine === '达梦') return await readDmDatabases(runtime, options)
      if (runtime.engine === '人大金仓') return await readKbDatabases(runtime, options)
      if (runtime.engine === 'SQLite') return await readSqliteDatabases(runtime, options)
      if (runtime.engine === 'DuckDB') return await readDuckDbDatabases(runtime, options)
      if (runtime.engine === 'SQL Server') return await readMssqlDatabases(runtime, options)
      if (runtime.engine === 'MongoDB') return await readMongoDatabases(runtime, options)
      if (runtime.engine === 'ClickHouse') return await readChDatabases(runtime, options)
      if (runtime.engine === 'Redis') return await readRedisDatabases(runtime)
      if (runtime.engine !== 'MySQL' && runtime.engine !== 'MariaDB' && runtime.engine !== 'TiDB') {
        const defaultDbName = runtime.defaultDatabase || 'default'
        return [
          {
            name: defaultDbName,
            charset: 'utf8mb4',
            collation: 'utf8mb4_general_ci',
            tables: [],
            views: [],
            functions: [],
            procedures: [],
            indexes: [],
            triggers: []
          }
        ]
      }

      // 使用连接池：getPool 会懒创建并缓存连接（persistent 连接）或使用临时连接（测试时）
      const pool = persistent
        ? getMysqlPool(runtime)
        : createPool({
            host: runtime.host,
            port: runtime.port,
            user: runtime.username,
            password: runtime.password,
            database: undefined,
            connectTimeout: 5000,
            multipleStatements: false,
            supportBigNumbers: true,
            bigNumberStrings: true,
            dateStrings: true,
            ssl: buildSslConfig(runtime),
            connectionLimit: 3
          })

      const optionalQuery = async <Row extends RowDataPacket>(sql: string): Promise<Row[]> => {
        try {
          const [rows] = await pool.query<Row[]>(sql)
          return rows
        } catch (error) {
          console.warn('读取可选数据库元数据失败：', this.errorMessage(error))
          return []
        }
      }

      try {
      // 核心查询：始终只获取库名+表名（P0 元数据懒加载）
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

      const columnsByTable = new Map<string, import('@/shared/connections').TableColumn[]>()
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
    } finally {
      if (!persistent) sshTunnelManager.closeTunnel(tunnelKey)
    }
  }

  /**
   * 按需加载单个数据库的完整元数据（P0-3 懒加载）。
   * 仅在连接已打开且需要查看数据库详情时调用。
   */
  async readDatabaseDetail(connectionId: number, databaseName: string): Promise<DatabaseItem | null> {
    const stored = this.repository.getById(connectionId)
    if (!stored || !stored.open) return null

    const runtime = await this.prepareRuntimeConnection(stored, stored.id)
    try {
      if (runtime.engine === 'PostgreSQL') {
        return await readPostgreSqlDatabaseDetail(runtime, databaseName)
      }
      if (runtime.engine === 'SQLite') {
        const databases = await readSqliteDatabases(runtime)
        return databases[0] ?? null
      }
      if (runtime.engine === 'DuckDB') {
        const databases = await readDuckDbDatabases(runtime)
        return databases[0] ?? null
      }
      if (runtime.engine === 'SQL Server') {
        const databases = await readMssqlDatabases(runtime, { light: true })
        return databases.find((db) => db.name === databaseName) ?? null
      }
      if (runtime.engine === 'MongoDB') {
        const databases = await readMongoDatabases(runtime, { light: true })
        return databases.find((db) => db.name === databaseName) ?? null
      }
      if (runtime.engine === 'ClickHouse') {
        const databases = await readChDatabases(runtime, { light: true })
        return databases.find((db) => db.name === databaseName) ?? null
      }
      if (runtime.engine === 'Redis') {
        const databases = await readRedisDatabases(runtime)
        return databases.find((db) => db.name === databaseName) ?? null
      }
      // MySQL：按需仅查询指定数据库的完整元数据
      if (runtime.engine === 'MySQL') {
        const pool = getMysqlPool(runtime)
        const optionalQuery = async <Row extends RowDataPacket>(sql: string, params?: unknown[]): Promise<Row[]> => {
          try {
            const [rows] = await pool.query<Row[]>(sql, params)
            return rows
          } catch (error) {
            console.warn('读取 MySQL 数据库详情失败：', this.errorMessage(error))
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
        const columnsByTable = new Map<string, import('@/shared/connections').TableColumn[]>()
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
          triggers: [] as string[]
        }
      }

      return null
    } catch (error) {
      console.error('读取数据库详情失败：', this.errorMessage(error))
      return null
    }
  }

  private validate(input: CreateConnectionInput): string | null {
    if (!input.name.trim()) return '请输入连接名称'
    if (input.engine === 'SSH') {
      if (!input.host.trim()) return '请输入 SSH 主机地址'
      if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) return 'SSH 端口必须在 1 至 65535 之间'
      if (!input.username.trim()) return '请输入 SSH 用户名'
      const authType = input.ssh?.authType ?? 'password'
      if (authType === 'privateKey' && !input.ssh?.privateKeyPath?.trim()) return '请选择 SSH 私钥文件'
      return null
    }
    if (!input.host.trim()) return (input.engine === 'SQLite' || input.engine === 'DuckDB') ? '请输入数据库文件路径' : '请输入主机地址'
    if (input.engine !== 'SQLite' && input.engine !== 'DuckDB' && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) return '端口必须在 1 至 65535 之间'
    if (input.engine !== 'SQLite' && input.engine !== 'DuckDB' && !input.username.trim()) return '请输入用户名'
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
    if (engine === 'PostgreSQL' || engine === 'DuckDB' || engine === 'SQL Server') return `"${identifier.replaceAll('"', '""')}"`
    return this.quoteIdentifier(identifier)
  }

  private quoteString(value: string): string {
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
  }

  private async executeDatabaseStatement(
    connectionId: number,
    sql: string,
    successMessage: string
  ): Promise<ConnectionActionResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    const pool = getMysqlPool(connection)
    try {
      await pool.query(sql)
      try {
        this.repository.recordQueryRun({
          connectionId,
          connectionName: connection.name,
          engine: connection.engine,
          databaseName: connection.defaultDatabase,
          sql,
          success: true,
          queryCount: 1
        })
        await this.refreshStatsForSql(connection, connection.defaultDatabase, sql, true)
      } catch (recordError) {
        console.warn('记录工作台查询统计失败：', this.errorMessage(recordError))
      }
      return { success: true, message: successMessage }
    } catch (error) {
      const message = this.errorMessage(error)
      try {
        this.repository.recordQueryRun({
          connectionId,
          connectionName: connection.name,
          engine: connection.engine,
          databaseName: connection.defaultDatabase,
          sql,
          success: false,
          queryCount: 1,
          errorMessage: message
        })
      } catch (recordError) {
        console.warn('记录工作台查询统计失败：', this.errorMessage(recordError))
      }
      return { success: false, message }
    }
  }

  async getProcessList(connectionId: number): Promise<ProcessListResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    const engine = connection.engine
    const defaultDb = connection.defaultDatabase || ''

    let processSql = 'SHOW FULL PROCESSLIST;'
    if (engine === 'PostgreSQL' || engine === '人大金仓') {
      processSql = `SELECT pid AS "id", usename AS "user", client_addr || ':' || client_port AS "host", datname AS "db", state AS "command", round(EXTRACT(EPOCH FROM (now() - query_start)))::integer AS "time", state AS "state", query AS "info" FROM pg_stat_activity WHERE pid <> pg_backend_pid();`
    } else if (engine === 'SQLite') {
      processSql = 'PRAGMA database_list;'
    } else if (engine === 'Oracle' || engine === '达梦') {
      processSql = engine === '达梦'
        ? `SELECT sess_id AS "id", user_name AS "user", clnt_ip AS "host", db_name AS "db", state AS "command", datediff(ss, create_time, sysdate) AS "time", state AS "state", sql_text AS "info" FROM v$sessions;`
        : `SELECT sid || ',' || serial# AS "id", username AS "user", machine AS "host", schemaname AS "db", status AS "command", last_call_et AS "time", status AS "state", sql_id AS "info" FROM v$session WHERE type = 'USER';`
    } else if (engine === 'SQL Server') {
      processSql = `SELECT session_id AS "id", login_name AS "user", host_name AS "host", DB_NAME(database_id) AS "db", status AS "command", total_elapsed_time / 1000 AS "time", status AS "state", '' AS "info" FROM sys.dm_exec_sessions WHERE is_user_process = 1;`
    } else if (engine === 'ClickHouse') {
      processSql = `SELECT query_id AS "id", user AS "user", client_name AS "host", current_database AS "db", 'Query' AS "command", elapsed AS "time", 'running' AS "state", query AS "info" FROM system.processes;`
    } else if (engine === 'DuckDB') {
      processSql = `SELECT connection_id AS "id", 'user' AS "user", 'localhost' AS "host", database_name AS "db", 'Active' AS "command", 0 AS "time", 'active' AS "state", '' AS "info" FROM duckdb_connections();`
    }

    try {
      const res = await this.executeQuery(connectionId, defaultDb, processSql)
      if (!res.success || !res.rows) {
        return { success: false, message: res.message || '查询活动进程失败', rawSql: processSql }
      }

      const processes: ProcessItem[] = res.rows.map((row, index) => {
        const rowObj = row as Record<string, unknown>
        return {
          id: String(rowObj.id ?? rowObj.Id ?? rowObj.ID ?? rowObj.pid ?? rowObj.seq ?? index + 1),
          user: String(rowObj.user ?? rowObj.User ?? rowObj.usename ?? rowObj.user_name ?? 'local'),
          host: String(rowObj.host ?? rowObj.Host ?? rowObj.client_addr ?? rowObj.clnt_ip ?? 'localhost'),
          db: String(rowObj.db ?? rowObj.Db ?? rowObj.datname ?? rowObj.db_name ?? defaultDb),
          command: String(rowObj.command ?? rowObj.Command ?? rowObj.state ?? rowObj.Status ?? 'active'),
          time: Number(rowObj.time ?? rowObj.Time ?? rowObj.elapsed ?? 0),
          state: String(rowObj.state ?? rowObj.State ?? rowObj.status ?? 'running'),
          info: String(rowObj.info ?? rowObj.Info ?? rowObj.query ?? rowObj.sql_text ?? rowObj.file ?? ''),
          raw: rowObj
        }
      })

      return { success: true, processes, rawSql: processSql }
    } catch (err) {
      return { success: false, message: this.errorMessage(err), rawSql: processSql }
    }
  }

  async killProcess(connectionId: number, processId: string | number): Promise<KillProcessResult> {
    const connection = this.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    const engine = connection.engine
    const defaultDb = connection.defaultDatabase || ''

    if (engine === 'SQLite') {
      return { success: false, message: 'SQLite 为单机文件数据库，不支持终止远程进程' }
    }
    if (engine === 'DuckDB') {
      return { success: false, message: 'DuckDB 为嵌入式分析数据库，不支持终止进程' }
    }

    let killSql = `KILL ${processId};`
    if (engine === 'PostgreSQL' || engine === '人大金仓') {
      killSql = `SELECT pg_terminate_backend(${Number(processId)});`
    } else if (engine === 'Oracle') {
      const pidStr = String(processId)
      killSql = pidStr.includes(',')
        ? `ALTER SYSTEM KILL SESSION '${pidStr}';`
        : `ALTER SYSTEM KILL SESSION '${pidStr},1';`
    } else if (engine === '达梦') {
      killSql = `CALL SP_KILL_SESSION(${processId});`
    } else if (engine === 'SQL Server') {
      killSql = `KILL ${processId};`
    } else if (engine === 'ClickHouse') {
      killSql = `KILL QUERY WHERE query_id = '${String(processId).replaceAll("'", "''")}';`
    }

    try {
      const res = await this.executeQuery(connectionId, defaultDb, killSql)
      if (res.success) {
        return { success: true, message: `已成功终止进程 ${processId}` }
      }
      return { success: false, message: res.message || `终止进程 ${processId} 失败` }
    } catch (err) {
      return { success: false, message: this.errorMessage(err) }
    }
  }

  private errorMessage(error: unknown): string {
    if (!(error instanceof Error)) return '数据库连接失败'
    const msg = error.message || ''

    // ── SSH 隧道错误 ─────────────────────────────────────
    if (msg.includes('Authentication failed')) return 'SSH 认证失败，请检查用户名、密码或密钥'
    if (msg.includes('All configured authentication methods failed')) return 'SSH 所有认证方式均失败，请检查用户名、密码或密钥是否正确'
    if (msg.includes('connect ECONNREFUSED') || msg.includes('Connection refused')) return 'SSH 连接被拒绝，请检查 SSH 服务是否可用'
    if (msg.includes('Timed out while waiting for handshake')) return 'SSH 连接超时，请检查网络和 SSH 配置'

    if ('code' in error) {
      const code = String((error as { code?: string }).code)
      // ── 网络层 ──────────────────────────────────────────
      if (code === 'ECONNREFUSED') return '无法连接数据库，请确认数据库服务已启动且主机、端口正确'
      if (code === 'ETIMEDOUT' || code === 'HANDSHAKE_TIMEOUT') return '连接数据库超时，请检查网络或防火墙设置'
      if (code === 'ENOTFOUND') return '找不到数据库主机，请检查主机名是否正确'
      if (code === 'EHOSTUNREACH') return '无法访问数据库主机，请检查网络和路由'
      if (code === 'ECONNRESET') return '数据库连接被重置，请重试或检查网络稳定性'
      if (code === 'ECONNABORTED') return '数据库连接被中断，请重试'

      // ── MySQL / MariaDB ─────────────────────────────────
      if (code === 'ER_ACCESS_DENIED_ERROR') return 'MySQL 用户名或密码错误'
      if (code === 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR') return 'MySQL 不允许无密码登录，请设置密码'
      if (code === 'ER_BAD_DB_ERROR') return 'MySQL 数据库不存在'
      if (code === 'ER_DBACCESS_DENIED_ERROR') return 'MySQL 用户无权访问该数据库'

      // ── PostgreSQL ──────────────────────────────────────
      if (code === '28P01') return 'PostgreSQL 用户名或密码错误'
      if (code === '3D000') return 'PostgreSQL 默认数据库不存在'
      if (code === '28000') return 'PostgreSQL 拒绝连接，请检查 pg_hba.conf 配置'
      if (code === '57P03') return 'PostgreSQL 数据库尚未就绪，请稍后重试'

      // ── SQLite ──────────────────────────────────────────
      if (code === 'SQLITE_CANTOPEN') return '无法打开 SQLite 数据库文件，请检查路径和文件权限'
      if (code === 'SQLITE_NOTADB') return '指定的文件不是有效的 SQLite 数据库'

      // ── SQL Server ────────────────────────────────────
      if (code === 'ELOGIN') return 'SQL Server 登录失败，请检查用户名或密码'
      if (code === 'ERTLSCONNECT') return 'SQL Server 连接超时，请检查网络或服务是否启动'
      if (code === 'ECONNECTION') return 'SQL Server 无法建立连接，请确认主机和端口正确'

      // ── MongoDB ────────────────────────────────────
      if (code === 'MongoServerError' || code === 'MongoNetworkError') return 'MongoDB 连接失败，请检查主机地址和端口'
      if (code === 'MongoAuthError') return 'MongoDB 认证失败，请检查用户名或密码'

      // ── ClickHouse ────────────────────────────────────
      if (code === 'ECONNREFUSED') return 'ClickHouse 连接被拒绝，请检查服务是否启动'
      if (code === 'ETIMEOUT') return 'ClickHouse 连接超时，请检查网络或服务状态'

      // ── Redis ────────────────────────────────────
      if (code === 'ECONNREFUSED') return 'Redis 连接被拒绝，请检查服务是否启动'
      if (code === 'ETIMEDOUT') return 'Redis 连接超时，请检查网络或服务状态'
      if (code === 'WRONGPASS') return 'Redis 密码错误，请检查密码配置'

      // ── 达梦 / 人大金仓 ────────────────────────────────────
      if (code === '28P01') return '数据库认证失败，请检查用户名或密码'
      if (code === '3D000') return '指定的数据库不存在'

      // ── SSL / TLS ──────────────────────────────────────
      if (code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' || code === 'CERT_HAS_EXPIRED' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'SSL 证书验证失败，请检查证书配置或关闭 SSL'
    }

    // ── 兜底：返回精简后的原始消息 ──────────────────────
    if (msg.length > 200) return '数据库连接失败：' + msg.slice(0, 200) + '…'
    return msg || '数据库连接失败，请检查连接配置'
  }
}
