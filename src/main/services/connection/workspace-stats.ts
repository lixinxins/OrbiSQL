import type { StoredConnection } from '../../database/connection-repository'
import type { QueryRunInput } from '../../database/workspace-stats-domain'
import type { ConnectionCore } from './connection-core'
import type { MetadataReader } from './metadata-reader'

/**
 * 工作台统计编排：查询运行记录 + 数据库元数据统计刷新。
 * 依赖 MetadataReader 的 readDatabases 读取库表元数据，
 * 该引用由 ConnectionService 在装配完成后回填。
 */
export class WorkspaceStats {
  metadataReader: MetadataReader | null = null

  constructor(private readonly core: ConnectionCore) {}

  recordQueryRun(input: QueryRunInput): void {
    this.core.repository.recordQueryRun(input)
  }

  async refreshPersistedDatabaseStats(connection: StoredConnection, databaseName?: string): Promise<void> {
    if (connection.engine === 'SSH' || !connection.open) return
    try {
      const databases = await this.metadataReader!.readDatabases(connection, { light: true })
      const scopedDatabases = databaseName ? databases.filter((database) => database.name === databaseName) : databases
      this.core.repository.replaceDatabaseStats(connection, scopedDatabases.length ? scopedDatabases : databases)
    } catch (error) {
      console.warn('刷新工作台数据库统计失败：', this.core.errorMessage(error))
    }
  }

  async refreshStatsForSql(connection: StoredConnection, databaseName: string, sql: string, success: boolean): Promise<void> {
    if (!success) return
    if (!/\b(create|drop|alter|rename|truncate)\s+(table|database|schema)\b/i.test(sql)) return
    const isDatabaseDdl = /\b(create|drop|alter|rename)\s+(database|schema)\b/i.test(sql)
    await this.refreshPersistedDatabaseStats(connection, isDatabaseDdl ? undefined : databaseName)
  }
}
