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
  QueryExecutionResult,
  QueryDeleteRowInput,
  QueryUpdateRowInput,
  RenameTableInput,
  SaveQueryInput,
  SavedQuery,
  TableDataFilter,
  TableDefinitionResult,
  UpdateDatabaseInput,
  UpdateTableInput,
  UpdateConnectionInput,
  ProcessListResult,
  KillProcessResult
} from '../../shared/connections'
import { ConnectionRepository, type StoredConnection } from '../database/connection-repository'
import { engineEntryOrNull } from './engine-registry'
import { ConnectionCore } from './connection/connection-core'
import { ConnectionLifecycle } from './connection/connection-lifecycle'
import { ConfigTransfer } from './connection/config-transfer'
import { MetadataReader } from './connection/metadata-reader'
import { ProcessList } from './connection/process-list'
import { QueryExecution } from './connection/query-execution'
import { WorkspaceStats } from './connection/workspace-stats'
import type { ReadDatabasesOptions } from './adapters/postgresql-adapter'

/**
 * 连接服务门面：按职责把实现下沉到 connection/ 下的领域模块，
 * 本文件仅保留路由与编排（心跳、模块装配与公开方法委托），
 * 对外 IPC / preload API 契约保持不变。
 */
export class ConnectionService {
  private heartbeatTimer: NodeJS.Timeout | null = null
  private readonly core: ConnectionCore
  private readonly lifecycle: ConnectionLifecycle
  private readonly query: QueryExecution
  private readonly metadata: MetadataReader
  private readonly processList: ProcessList
  private readonly config: ConfigTransfer
  private readonly stats: WorkspaceStats

  constructor(public readonly repository: ConnectionRepository) {
    this.core = new ConnectionCore(repository)
    this.stats = new WorkspaceStats(this.core)
    this.query = new QueryExecution(this.core, this.stats)
    this.metadata = new MetadataReader(this.core, this.query, this.stats)
    this.stats.metadataReader = this.metadata
    this.lifecycle = new ConnectionLifecycle(this.core, this.metadata)
    this.config = new ConfigTransfer(this.core, this.lifecycle)
    this.processList = new ProcessList(this.core, this.query)
    this.startHeartbeatTimer()
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
      const entry = engineEntryOrNull(conn.engine)
      if (!entry?.healthCheck) continue
      try {
        await entry.healthCheck(conn)
      } catch (err) {
        console.warn(`[ConnectionService] 心跳检测连接 ${conn.name} (ID: ${conn.id}) 失败:`, err)
      }
    }
  }

  // ── 连接配置导入导出 ──────────────────────────────────────────────

  updateSortOrders(orders: Array<{ id: number; sortOrder: number }>): ConnectionActionResult {
    return this.lifecycle.updateSortOrders(orders)
  }

  exportConfig(options?: {
    targetPath?: string
    selectedIds?: number[]
    includePasswords?: boolean
  }): Promise<{ success: boolean; message: string; filePath?: string }> {
    return this.config.exportConfig(options)
  }

  readImportConfigFile(sourcePath?: string): Promise<{
    success: boolean
    message: string
    filePath?: string
    groups?: Array<{ name: string; category?: 'database' | 'ssh' }>
    connections?: Array<CreateConnectionInput & { groupName?: string }>
  }> {
    return this.config.readImportConfigFile(sourcePath)
  }

  importConfig(options?: {
    filePath?: string
    sourcePath?: string
    groups?: Array<{ name: string; category?: 'database' | 'ssh' }>
    connections?: Array<CreateConnectionInput & { groupName?: string }>
  }): Promise<{ success: boolean; message: string }> {
    return this.config.importConfig(options)
  }

  // ── 连接生命周期 ──────────────────────────────────────────────────

  list(): Promise<DatabaseConnection[]> {
    return this.lifecycle.list()
  }

  getOne(id: number): Promise<DatabaseConnection | null> {
    return this.lifecycle.getOne(id)
  }

  listConnectionGroups(): ConnectionGroup[] {
    return this.lifecycle.listConnectionGroups()
  }

  createConnectionGroup(name: string, category: 'database' | 'ssh' = 'database'): ConnectionActionResult {
    return this.lifecycle.createConnectionGroup(name, category)
  }

  deleteConnectionGroup(id: number): ConnectionActionResult {
    return this.lifecycle.deleteConnectionGroup(id)
  }

  renameConnectionGroup(id: number, name: string): ConnectionActionResult {
    return this.lifecycle.renameConnectionGroup(id, name)
  }

  setConnectionGroup(connectionId: number, groupId: number | null): ConnectionActionResult {
    return this.lifecycle.setConnectionGroup(connectionId, groupId)
  }

  listSavedQueries(connectionId: number, databaseName: string): SavedQuery[] {
    return this.lifecycle.listSavedQueries(connectionId, databaseName)
  }

  saveQuery(input: SaveQueryInput): ConnectionActionResult {
    return this.lifecycle.saveQuery(input)
  }

  deleteSavedQuery(id: number, connectionId: number, databaseName: string): ConnectionActionResult {
    return this.lifecycle.deleteSavedQuery(id, connectionId, databaseName)
  }

  async create(input: CreateConnectionInput): Promise<ConnectionActionResult> {
    return this.lifecycle.create(input)
  }

  async updateColor(id: number, color: string): Promise<ConnectionActionResult> {
    return this.lifecycle.updateColor(id, color)
  }

  async updateEnvironment(id: number, environment: ConnectionEnvironment | null): Promise<ConnectionActionResult> {
    return this.lifecycle.updateEnvironment(id, environment)
  }

  async update(input: UpdateConnectionInput): Promise<ConnectionActionResult> {
    return this.lifecycle.update(input)
  }

  async open(id: number): Promise<ConnectionActionResult> {
    return this.lifecycle.open(id)
  }

  async close(id: number): Promise<ConnectionActionResult> {
    return this.lifecycle.close(id)
  }

  duplicate(id: number): ConnectionActionResult {
    return this.lifecycle.duplicate(id)
  }

  async delete(id: number): Promise<ConnectionActionResult> {
    return this.lifecycle.delete(id)
  }

  async test(input: CreateConnectionInput): Promise<ConnectionActionResult> {
    return this.lifecycle.test(input)
  }

  async testUpdate(input: UpdateConnectionInput): Promise<ConnectionActionResult> {
    return this.lifecycle.testUpdate(input)
  }

  // ── 查询执行与游标 ────────────────────────────────────────────────

  async executeSql(id: number, sql: string, databaseName?: string): Promise<ConnectionActionResult> {
    return this.query.executeSql(id, sql, databaseName)
  }

  async executeQuery(connectionId: number, databaseName: string, sql: string, sessionId?: string): Promise<QueryExecutionResult> {
    return this.query.executeQuery(connectionId, databaseName, sql, sessionId)
  }

  async beginTransaction(connectionId: number, databaseName: string, sessionId: string): Promise<ConnectionActionResult> {
    return this.query.beginTransaction(connectionId, databaseName, sessionId)
  }

  async commitTransaction(sessionId: string): Promise<ConnectionActionResult> {
    return this.query.commitTransaction(sessionId)
  }

  async rollbackTransaction(sessionId: string): Promise<ConnectionActionResult> {
    return this.query.rollbackTransaction(sessionId)
  }

  async fetchMoreRows(connectionId: number, databaseName: string, cursorId: string): Promise<{
    success: boolean
    message: string
    rows?: Array<Record<string, unknown>>
    done?: boolean
    offset?: number
    totalRows?: number
  }> {
    return this.query.fetchMoreRows(connectionId, databaseName, cursorId)
  }

  async updateQueryRow(input: QueryUpdateRowInput): Promise<ConnectionActionResult> {
    return this.query.updateQueryRow(input)
  }

  async deleteQueryRow(input: QueryDeleteRowInput): Promise<ConnectionActionResult> {
    return this.query.deleteQueryRow(input)
  }

  // ── 库表 DDL / 元数据读取 ─────────────────────────────────────────

  async createDatabase(input: DatabaseDefinitionInput): Promise<ConnectionActionResult> {
    return this.metadata.createDatabase(input)
  }

  async updateDatabase(input: UpdateDatabaseInput): Promise<ConnectionActionResult> {
    return this.metadata.updateDatabase(input)
  }

  async deleteDatabase(connectionId: number, databaseName: string): Promise<ConnectionActionResult> {
    return this.metadata.deleteDatabase(connectionId, databaseName)
  }

  async deleteTable(connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> {
    return this.metadata.deleteTable(connectionId, databaseName, tableName)
  }

  async renameTable(input: RenameTableInput): Promise<ConnectionActionResult> {
    return this.metadata.renameTable(input)
  }

  async readTableData(
    connectionId: number,
    databaseName: string,
    tableName: string,
    limit: number,
    offset: number,
    filter?: TableDataFilter
  ): Promise<QueryExecutionResult> {
    return this.metadata.readTableData(connectionId, databaseName, tableName, limit, offset, filter)
  }

  async truncateTable(connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> {
    return this.metadata.truncateTable(connectionId, databaseName, tableName)
  }

  async copyTable(input: CopyTableInput): Promise<ConnectionActionResult> {
    return this.metadata.copyTable(input)
  }

  async listCharsets(connectionId: number): Promise<DatabaseCharsetResult> {
    return this.metadata.listCharsets(connectionId)
  }

  async createTable(input: CreateTableInput): Promise<ConnectionActionResult> {
    return this.metadata.createTable(input)
  }

  async getTableDefinition(
    connectionId: number,
    databaseName: string,
    tableName: string
  ): Promise<TableDefinitionResult> {
    return this.metadata.getTableDefinition(connectionId, databaseName, tableName)
  }

  async updateTable(input: UpdateTableInput): Promise<ConnectionActionResult> {
    return this.metadata.updateTable(input)
  }

  async readDatabases(
    connection: StoredConnection | CreateConnectionInput,
    options?: ReadDatabasesOptions
  ): Promise<DatabaseItem[]> {
    return this.metadata.readDatabases(connection, options)
  }

  async readDatabaseDetail(connectionId: number, databaseName: string): Promise<DatabaseItem | null> {
    return this.metadata.readDatabaseDetail(connectionId, databaseName)
  }

  // ── 进程列表 ──────────────────────────────────────────────────────

  async getProcessList(connectionId: number): Promise<ProcessListResult> {
    return this.processList.getProcessList(connectionId)
  }

  async killProcess(connectionId: number, processId: string | number): Promise<KillProcessResult> {
    return this.processList.killProcess(connectionId, processId)
  }
}
