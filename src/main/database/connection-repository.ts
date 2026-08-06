import type { ConnectionEnvironment, ConnectionGroup, CreateConnectionInput, DatabaseItem, SaveQueryInput, SavedQuery, UpdateConnectionInput, WorkspaceStats } from '../../shared/connections'
import type { AiSaveModelInput } from '../../shared/ai-agent'
import { DatabaseSync, type SqliteDatabase } from '../services/sqlite-runtime'
import { AiModelsRepository, type StoredAiModel } from './ai-models-domain'
import { ConnectionsRepository, type StoredConnection } from './connections-domain'
import { GroupsRepository } from './groups-domain'
import { SavedQueriesRepository } from './saved-queries-domain'
import { initializeSchema, runMigrations } from './schema'
import { WorkspaceStatsRepository, type QueryRunInput } from './workspace-stats-domain'

export type { StoredAiModel } from './ai-models-domain'
export type { StoredConnection } from './connections-domain'

/**
 * 连接配置仓储门面。
 *
 * 按表域拆分到独立仓储（connections / groups / saved_queries / ai_models /
 * workspace stats），全部共享同一个 DatabaseSync 连接；schema_version
 * 迁移逻辑统一收敛在 schema.ts，保证启动时按版本迁移后各域才能访问表。
 */
export class ConnectionRepository {
  private readonly database: SqliteDatabase
  private readonly connections: ConnectionsRepository
  private readonly groups: GroupsRepository
  private readonly savedQueries: SavedQueriesRepository
  private readonly aiModels: AiModelsRepository
  private readonly workspaceStats: WorkspaceStatsRepository

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    initializeSchema(this.database)
    runMigrations(this.database)
    this.connections = new ConnectionsRepository(this.database)
    this.groups = new GroupsRepository(this.database)
    this.savedQueries = new SavedQueriesRepository(this.database)
    this.aiModels = new AiModelsRepository(this.database)
    this.workspaceStats = new WorkspaceStatsRepository(this.database)
  }

  // ── connections ────────────────────────────────────────────────────

  list(): StoredConnection[] {
    return this.connections.list()
  }

  getById(id: number): StoredConnection | null {
    return this.connections.getById(id)
  }

  create(input: CreateConnectionInput): number {
    return this.connections.create(input)
  }

  updateSortOrders(orders: Array<{ id: number; sortOrder: number }>): void {
    this.connections.updateSortOrders(orders)
  }

  updateColor(id: number, color: string): void {
    this.connections.updateColor(id, color)
  }

  updateEnvironment(id: number, environment: ConnectionEnvironment | null): void {
    this.connections.updateEnvironment(id, environment)
  }

  update(input: UpdateConnectionInput): void {
    this.connections.update(input)
  }

  setOpen(id: number, open: boolean): void {
    this.connections.setOpen(id, open)
  }

  delete(id: number): void {
    this.connections.delete(id)
  }

  duplicate(id: number): number {
    return this.connections.duplicate(id)
  }

  // ── groups ─────────────────────────────────────────────────────────

  listGroups(): ConnectionGroup[] {
    return this.groups.listGroups()
  }

  createGroup(name: string, category: 'database' | 'ssh' = 'database'): void {
    this.groups.createGroup(name, category)
  }

  deleteGroup(id: number): void {
    this.groups.deleteGroup(id)
  }

  renameGroup(id: number, newName: string): void {
    this.groups.renameGroup(id, newName)
  }

  setConnectionGroup(connectionId: number, groupId: number | null): void {
    this.groups.setConnectionGroup(connectionId, groupId)
  }

  // ── saved queries ──────────────────────────────────────────────────

  listSavedQueries(connectionId: number, databaseName: string): SavedQuery[] {
    return this.savedQueries.listSavedQueries(connectionId, databaseName)
  }

  saveQuery(input: SaveQueryInput): void {
    this.savedQueries.saveQuery(input)
  }

  deleteSavedQuery(id: number, connectionId: number, databaseName: string): boolean {
    return this.savedQueries.deleteSavedQuery(id, connectionId, databaseName)
  }

  // ── workspace stats ────────────────────────────────────────────────

  recordQueryRun(input: QueryRunInput): void {
    this.workspaceStats.recordQueryRun(input)
  }

  replaceDatabaseStats(connection: StoredConnection, databases: DatabaseItem[]): void {
    this.workspaceStats.replaceDatabaseStats(connection, databases)
  }

  removeDatabaseStats(connectionId: number, databaseName: string): void {
    this.workspaceStats.removeDatabaseStats(connectionId, databaseName)
  }

  getWorkspaceStats(range: '7d' | '30d' | '90d' = '7d'): WorkspaceStats {
    return this.workspaceStats.getWorkspaceStats(range)
  }

  // ── ai models ──────────────────────────────────────────────────────

  listAiModels(): StoredAiModel[] {
    return this.aiModels.listAiModels()
  }

  getAiModel(id: number): StoredAiModel | null {
    return this.aiModels.getAiModel(id)
  }

  saveAiModel(input: AiSaveModelInput): StoredAiModel {
    return this.aiModels.saveAiModel(input)
  }

  deleteAiModel(id: number): boolean {
    return this.aiModels.deleteAiModel(id)
  }
}
