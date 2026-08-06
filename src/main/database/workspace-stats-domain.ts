import type { DatabaseItem, WorkspaceStats } from '../../shared/connections'
import type { SqliteDatabase } from '../services/sqlite-runtime'
import type { StoredConnection } from './connections-domain'

export interface QueryRunInput {
  connectionId: number
  connectionName: string
  engine: string
  databaseName: string
  sql: string
  success: boolean
  queryCount: number
  affectedRows?: number
  durationMs?: number
  errorMessage?: string
}

function countDatabaseTables(database: DatabaseItem): number {
  const tableKeys = new Set<string>()
  database.tables.forEach((table) => tableKeys.add(`default.${table.name}`))
  database.schemas?.forEach((schema) => {
    schema.tables.forEach((table) => tableKeys.add(`${schema.name}.${table.name}`))
  })
  return tableKeys.size
}

function countDatabaseObjects(database: DatabaseItem): number {
  const schemaObjectCount = database.schemas?.reduce((sum, schema) =>
    sum
    + schema.tables.length
    + schema.views.length
    + schema.functions.length
    + (schema.procedures?.length ?? 0)
    + (schema.sequences?.length ?? 0)
    + (schema.materializedViews?.length ?? 0)
    + (schema.extensions?.length ?? 0)
    + (schema.types?.length ?? 0)
    + (schema.domains?.length ?? 0)
    + (schema.foreignTables?.length ?? 0)
    + (schema.triggers?.length ?? 0),
  0) ?? 0
  return schemaObjectCount
    + database.tables.length
    + database.views.length
    + database.functions.length
    + database.procedures.length
    + database.indexes.length
    + database.triggers.length
    + (database.materializedViews?.length ?? 0)
    + (database.sequences?.length ?? 0)
    + (database.extensions?.length ?? 0)
    + (database.types?.length ?? 0)
    + (database.domains?.length ?? 0)
    + (database.foreignTables?.length ?? 0)
    + (database.packages?.length ?? 0)
    + (database.synonyms?.length ?? 0)
    + (database.events?.length ?? 0)
    + (database.dictionaries?.length ?? 0)
    + (database.aliases?.length ?? 0)
    + (database.dataStreams?.length ?? 0)
    + (database.mappings?.length ?? 0)
}

function queryTitle(sql: string): string {
  const firstWord = sql.trim().split(/\s+/)[0]?.toUpperCase() || 'SQL'
  const titleMap: Record<string, string> = {
    SELECT: '查询数据',
    INSERT: '新增数据',
    UPDATE: '更新数据',
    DELETE: '删除数据',
    CREATE: '创建结构',
    DROP: '删除结构',
    ALTER: '修改结构',
    TRUNCATE: '清空数据'
  }
  return titleMap[firstWord] ?? `${firstWord} 语句`
}

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return value
  const diffMs = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diffMs < minute) return '刚刚'
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`
  return new Date(value).toLocaleDateString('zh-CN')
}

export class WorkspaceStatsRepository {
  constructor(private readonly database: SqliteDatabase) {}

  recordQueryRun(input: QueryRunInput): void {
    this.database.prepare(`
      INSERT INTO workspace_query_runs (
        connection_id, connection_name, engine, database_name, sql_text, success,
        query_count, affected_rows, duration_ms, error_message, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.connectionId,
      input.connectionName,
      input.engine,
      input.databaseName,
      input.sql,
      input.success ? 1 : 0,
      Math.max(1, Math.trunc(input.queryCount || 1)),
      input.affectedRows ?? null,
      input.durationMs ?? null,
      input.errorMessage ?? '',
      new Date().toISOString()
    )
  }

  replaceDatabaseStats(connection: StoredConnection, databases: DatabaseItem[]): void {
    const deleteStatement = this.database.prepare('DELETE FROM workspace_database_stats WHERE connection_id = ? AND database_name = ?')
    const insertStatement = this.database.prepare(`
      INSERT INTO workspace_database_stats (
        connection_id, database_name, engine, table_count, view_count, function_count,
        procedure_count, object_count, estimated_data_bytes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    this.database.exec('BEGIN TRANSACTION')
    try {
      for (const database of databases) {
        const tableCount = countDatabaseTables(database)
        const viewCount = database.views.length + (database.schemas?.reduce((sum, schema) => sum + schema.views.length + (schema.materializedViews?.length ?? 0), 0) ?? 0)
        const functionCount = database.functions.length + (database.schemas?.reduce((sum, schema) => sum + schema.functions.length, 0) ?? 0)
        const procedureCount = database.procedures.length + (database.schemas?.reduce((sum, schema) => sum + (schema.procedures?.length ?? 0), 0) ?? 0)
        deleteStatement.run(connection.id, database.name)
        insertStatement.run(
          connection.id,
          database.name,
          connection.engine,
          tableCount,
          viewCount,
          functionCount,
          procedureCount,
          countDatabaseObjects(database),
          database.dataBytes == null ? null : Math.max(0, Math.trunc(database.dataBytes))
        )
      }
      this.database.exec('COMMIT')
    } catch (err) {
      this.database.exec('ROLLBACK')
      throw err
    }
  }

  removeDatabaseStats(connectionId: number, databaseName: string): void {
    this.database.prepare('DELETE FROM workspace_database_stats WHERE connection_id = ? AND database_name = ?').run(connectionId, databaseName)
  }

  getWorkspaceStats(range: '7d' | '30d' | '90d' = '7d'): WorkspaceStats {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayStartIso = startOfToday.toISOString()
    const connections = this.database.prepare(`
      SELECT
        SUM(CASE WHEN is_open = 1 AND engine <> 'SSH' THEN 1 ELSE 0 END) AS activeConnections,
        SUM(CASE WHEN engine <> 'SSH' THEN 1 ELSE 0 END) AS savedDatabaseConnections
      FROM saved_connections
    `).get() as unknown as { activeConnections: number | null; savedDatabaseConnections: number | null }
    const queries = this.database.prepare(`
      SELECT
        COALESCE(SUM(query_count), 0) AS todayQueryCount,
        COALESCE(SUM(CASE WHEN success = 1 THEN query_count ELSE 0 END), 0) AS todaySuccessfulQueryCount
      FROM workspace_query_runs
      WHERE executed_at >= ?
    `).get(todayStartIso) as unknown as { todayQueryCount: number | null; todaySuccessfulQueryCount: number | null }
    const databaseStats = this.database.prepare(`
      SELECT
        COUNT(*) AS databaseCount,
        COALESCE(SUM(table_count), 0) AS tableCount,
        COALESCE(SUM(object_count), 0) AS dataObjectCount,
        SUM(estimated_data_bytes) AS dataBytes
      FROM workspace_database_stats
    `).get() as unknown as { databaseCount: number | null; tableCount: number | null; dataObjectCount: number | null; dataBytes: number | null }
    const recentQueries = (this.database.prepare(`
      SELECT id, sql_text, success, executed_at
      FROM workspace_query_runs
      ORDER BY executed_at DESC, id DESC
      LIMIT 5
    `).all() as unknown as Array<{ id: number; sql_text: string; success: number; executed_at: string }>).map((row) => ({
      id: Number(row.id),
      title: queryTitle(row.sql_text),
      sql: row.sql_text,
      time: relativeTime(row.executed_at),
      success: Boolean(row.success)
    }))
    const connectionSummaries = (this.database.prepare(`
      SELECT id, name, engine, database_name, color, is_open
      FROM saved_connections
      WHERE engine <> 'SSH'
      ORDER BY is_open DESC, updated_at DESC, id DESC
      LIMIT 4
    `).all() as unknown as Array<{ id: number; name: string; engine: string; database_name: string; color: string | null; is_open: number }>).map((row) => ({
      id: Number(row.id),
      name: row.name,
      engine: row.engine,
      database: row.database_name || 'default',
      latency: '未采集',
      color: row.color || '#347ff0',
      open: Boolean(row.is_open)
    }))
    const healthStart = new Date()
    healthStart.setDate(healthStart.getDate() - 7)
    const recentHealth = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
        AVG(duration_ms) AS averageLatencyMs
      FROM workspace_query_runs
      WHERE executed_at >= ?
    `).get(healthStart.toISOString()) as unknown as { total: number | null; failed: number | null; averageLatencyMs: number | null }
    const totalHealthQueries = Number(recentHealth.total ?? 0)
    const failedQueryRate = totalHealthQueries > 0 ? Number(recentHealth.failed ?? 0) / totalHealthQueries : 0
    const healthScore = Math.max(0, Math.min(100, Math.round(100 - failedQueryRate * 100 - (Number(recentHealth.averageLatencyMs ?? 0) > 1000 ? 8 : 0))))
    const healthStatus = healthScore >= 90 ? '运行状态优秀' : healthScore >= 75 ? '运行状态良好' : healthScore >= 60 ? '运行状态需关注' : '运行状态异常'
    return {
      activeConnections: Number(connections.activeConnections ?? 0),
      savedDatabaseConnections: Number(connections.savedDatabaseConnections ?? 0),
      todayQueryCount: Number(queries.todayQueryCount ?? 0),
      todaySuccessfulQueryCount: Number(queries.todaySuccessfulQueryCount ?? 0),
      databaseCount: Number(databaseStats.databaseCount ?? 0),
      tableCount: Number(databaseStats.tableCount ?? 0),
      dataObjectCount: Number(databaseStats.dataObjectCount ?? 0),
      dataBytes: databaseStats.dataBytes == null ? null : Number(databaseStats.dataBytes),
      healthScore,
      healthStatus,
      healthSummary: totalHealthQueries > 0
        ? `近 7 天执行 ${totalHealthQueries.toLocaleString('zh-CN')} 次，失败率 ${(failedQueryRate * 100).toFixed(2)}%。`
        : '暂无查询执行记录，连接打开后会自动累计运行状态。',
      averageLatencyMs: recentHealth.averageLatencyMs == null ? null : Math.round(Number(recentHealth.averageLatencyMs)),
      failedQueryRate,
      trend: this.getQueryTrend(range),
      recentQueries,
      connectionSummaries,
      updatedAt: new Date().toISOString()
    }
  }

  private getQueryTrend(range: '7d' | '30d' | '90d'): WorkspaceStats['trend'] {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - days + 1)
    const rows = this.database.prepare(`
      SELECT substr(executed_at, 1, 10) AS day, COALESCE(SUM(query_count), 0) AS count
      FROM workspace_query_runs
      WHERE executed_at >= ?
      GROUP BY substr(executed_at, 1, 10)
      ORDER BY day ASC
    `).all(start.toISOString()) as unknown as Array<{ day: string; count: number }>
    const countsByDay = new Map(rows.map((row) => [row.day, Number(row.count)]))
    const allPoints = Array.from({ length: days }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      const key = date.toISOString().slice(0, 10)
      return { date, count: countsByDay.get(key) ?? 0 }
    })
    const maxPoints = range === '7d' ? 7 : range === '30d' ? 10 : 12
    const step = Math.ceil(allPoints.length / maxPoints)
    const sampled = allPoints.filter((_, index) => index % step === 0 || index === allPoints.length - 1).slice(-maxPoints)
    const total = allPoints.reduce((sum, item) => sum + item.count, 0)
    return {
      range,
      label: range === '7d' ? '最近 7 天' : range === '30d' ? '最近 30 天' : '最近 90 天',
      subtitle: `过去 ${days} 天共执行 ${total.toLocaleString('zh-CN')} 条查询`,
      points: sampled.map((item) => item.count),
      labels: sampled.map((item) => range === '90d' ? `${item.date.getMonth() + 1}月` : `${item.date.getDate()}日`)
    }
  }
}
