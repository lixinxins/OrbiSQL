import type {
  ConnectionActionResult,
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput
} from '../../../shared/connections'
import { requireEngineEntry } from '../engine-registry'
import { splitSqlStatements } from '../sql-statement-splitter'
import { transactionManager } from '../transaction-manager'
import { getCursor } from '../query-cursor-manager'
import { sshTunnelManager } from '../ssh-tunnel-manager'
import type { ConnectionCore } from './connection-core'
import { isMysqlFamily } from './connection-utils'
import type { WorkspaceStats } from './workspace-stats'

/** 查询执行与游标：单条/批量 SQL、事务、游标分页、行级编辑。 */
export class QueryExecution {
  constructor(
    private readonly core: ConnectionCore,
    private readonly stats: WorkspaceStats
  ) {}

  async executeSql(id: number, sql: string, databaseName?: string): Promise<ConnectionActionResult> {
    const stored = this.core.repository.getById(id)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    const connection = this.core.runtimeConnection(stored)
    try {
      const entry = requireEngineEntry(connection.engine)
      if (!entry.executeFile) {
        return { success: false, message: `${connection.engine} 引擎暂不支持执行 SQL 文件` }
      }
      await entry.executeFile(connection, databaseName, sql)
      return { success: true, message: 'SQL 文件执行成功' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async executeQuery(connectionId: number, databaseName: string, sql: string, sessionId?: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) return { success: false, message: '请输入 SQL 语句' }
    const storedForStats = this.core.repository.getById(connectionId)
    const recordResult = async (result: QueryExecutionResult, queryCount: number): Promise<QueryExecutionResult> => {
      if (storedForStats) {
        try {
          this.stats.recordQueryRun({
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
          console.warn('记录工作台查询统计失败：', this.core.errorMessage(error))
        }
        await this.stats.refreshStatsForSql(storedForStats, databaseName, sql, result.success)
      }
      return result
    }
    if (sessionId && transactionManager.has(sessionId)) {
      try {
        const result = await transactionManager.execute(sessionId, sql)
        return await recordResult(result, Math.max(1, result.queryCount ?? splitSqlStatements(sql).length))
      } catch (error) {
        return await recordResult({ success: false, message: this.core.errorMessage(error), queryCount: 0, successCount: 0, errorCount: 1 }, 1)
      }
    }
    const statements = splitSqlStatements(sql)
    if (statements.length <= 1) {
      const result = await this.executeSingleQuery(connectionId, databaseName, statements[0] ?? sql)
      return await recordResult(result, 1)
    }
    const stored = this.core.repository.getById(connectionId)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    try {
      const connection = stored.sshEnabled && !sshTunnelManager.getEndpoint(connectionId)
        ? await this.core.prepareRuntimeConnection(stored, connectionId)
        : stored
      const result = await transactionManager.executeBatch(connection, databaseName, sql)
      return await recordResult(result, statements.length)
    } catch (error) {
      return await recordResult({ success: false, message: this.core.errorMessage(error), queryCount: statements.length, successCount: 0, errorCount: 1 }, statements.length)
    }
  }

  async beginTransaction(connectionId: number, databaseName: string, sessionId: string): Promise<ConnectionActionResult> {
    const stored = this.core.repository.getById(connectionId)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    try {
      const connection = stored.sshEnabled && !sshTunnelManager.getEndpoint(connectionId)
        ? await this.core.prepareRuntimeConnection(stored, connectionId)
        : stored
      await transactionManager.begin(sessionId, connection, databaseName)
      return { success: true, message: '事务已开始' }
    } catch (error) { return { success: false, message: this.core.errorMessage(error) } }
  }

  async commitTransaction(sessionId: string): Promise<ConnectionActionResult> {
    try { await transactionManager.commit(sessionId); return { success: true, message: '事务已提交' } }
    catch (error) { return { success: false, message: this.core.errorMessage(error) } }
  }

  async rollbackTransaction(sessionId: string): Promise<ConnectionActionResult> {
    try { await transactionManager.rollback(sessionId); return { success: true, message: '事务已回滚' } }
    catch (error) { return { success: false, message: this.core.errorMessage(error) } }
  }

  private async executeSingleQuery(connectionId: number, databaseName: string, sql: string): Promise<QueryExecutionResult> {
    if (!sql.trim()) return { success: false, message: '请输入 SQL 语句' }
    const stored = this.core.repository.getById(connectionId)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    let connection = stored
    if (stored.sshEnabled && !sshTunnelManager.getEndpoint(connectionId)) {
      try { connection = await this.core.prepareRuntimeConnection(stored, connectionId) }
      catch (error) { return { success: false, message: this.core.errorMessage(error) } }
    }

    try {
      const entry = requireEngineEntry(connection.engine)
      return await entry.execute(connection, databaseName, sql)
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
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
    const stored = this.core.repository.getById(connectionId)
    if (!stored) return { success: false, message: '连接不存在' }
    if (!stored.open) return { success: false, message: '请先打开连接' }
    const sameEngine = cursor.engine === stored.engine || (cursor.engine === 'MySQL' && isMysqlFamily(stored.engine))
    if (!sameEngine) return { success: false, message: '游标与当前数据库类型不匹配，请重新执行查询' }
    if (cursor.databaseName && databaseName && cursor.databaseName !== databaseName) {
      return { success: false, message: '游标与当前数据库不匹配，请重新执行查询' }
    }
    let connection = stored
    if (stored.sshEnabled && !sshTunnelManager.getEndpoint(connectionId)) {
      try { connection = await this.core.prepareRuntimeConnection(stored, connectionId) }
      catch (error) { return { success: false, message: this.core.errorMessage(error) } }
    }
    try {
      const entry = requireEngineEntry(stored.engine)
      const result = await entry.fetchMore(connection, databaseName, cursor)
      return {
        success: true,
        message: `获取 ${result.rows.length} 行${result.done ? '，已全部加载' : ''}`,
        rows: result.rows,
        done: result.done,
        offset: cursor.offset,
        totalRows: cursor.totalRows
      }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async updateQueryRow(input: QueryUpdateRowInput): Promise<ConnectionActionResult> {
    const connection = this.core.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    if (!Object.keys(input.changes).length) return { success: false, message: '没有需要保存的修改' }

    try {
      const entry = requireEngineEntry(connection.engine)
      if (!entry.updateRow) return { success: false, message: '该引擎暂不支持编辑行数据' }
      return await entry.updateRow(connection, input.databaseName, input)
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async deleteQueryRow(input: QueryDeleteRowInput): Promise<ConnectionActionResult> {
    const connection = this.core.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    try {
      const entry = requireEngineEntry(connection.engine)
      if (!entry.deleteRow) return { success: false, message: '该引擎暂不支持删除行数据' }
      return await entry.deleteRow(connection, input.databaseName, input)
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }
}
