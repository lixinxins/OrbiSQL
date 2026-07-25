import type { QueryExecutionResult, QueryStatementResult } from '../../shared/connections'
import type { StoredConnection } from '../database/connection-repository'
import { splitSqlStatements } from './sql-statement-splitter'
import { sqliteWorkerOpen, sqliteWorkerClose, sqliteWorkerQuery, sqliteWorkerExec } from './sqlite-runtime'
import {
  dbWorkerBeginMysqlTx,
  dbWorkerBeginPgTx,
  dbWorkerTxQuery,
  dbWorkerTxCommit,
  dbWorkerTxRollback,
  type DbWorkerQueryResult
} from './db-query-runtime'

const statementMessage = (rows: Array<Record<string, unknown>> | undefined, affectedRows: number): string =>
  rows ? `查询成功，共 ${rows.length} 行` : `执行成功，影响 ${affectedRows} 行`

/** MySQL 协议族：MySQL / MariaDB / TiDB 均使用 mysql2 驱动，可复用同一事务通道 */
const isMysqlFamily = (engine: string): boolean =>
  engine === 'MySQL' || engine === 'MariaDB' || engine === 'TiDB'

/** PostgreSQL 协议族：达梦 / 人大金仓 均 import { Pool } from 'pg'，可复用 PG 事务通道 */
const isPgFamily = (engine: string): boolean =>
  engine === 'PostgreSQL' || engine === '达梦' || engine === '人大金仓'

/** 事务空闲超时：30 分钟无活动自动回滚 */
const TX_IDLE_TIMEOUT_MS = 30 * 60 * 1000
/** 清理定时器间隔：5 分钟 */
const TX_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

type ActiveTransaction =
  | { engine: 'MySQL' | 'PostgreSQL'; sessionId: string; lastActivity: number }
  | { engine: 'SQLite'; handleId: string; lastActivity: number }

const extractResult = (result: DbWorkerQueryResult): { rows?: Array<Record<string, unknown>>; columns?: string[]; affectedRows: number } => {
  if (result.type === 'rows') {
    return { rows: result.rows, columns: result.columns, affectedRows: 0 }
  }
  return { affectedRows: result.affectedRows ?? result.rowCount ?? 0 }
}

export class TransactionManager {
  private readonly transactions = new Map<string, ActiveTransaction>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  has(sessionId: string): boolean { return this.transactions.has(sessionId) }

  /** 更新事务最后活动时间（心跳） */
  private touch(sessionId: string): void {
    const tx = this.transactions.get(sessionId)
    if (tx) tx.lastActivity = Date.now()
  }

  /** 启动清理定时器（懒启动） */
  private ensureCleanup(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => { this.cleanupIdleTransactions() }, TX_CLEANUP_INTERVAL_MS)
    // 允许 Node 进程在只剩定时器时正常退出
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as NodeJS.Timeout).unref()
    }
  }

  /** 停止清理定时器 */
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /** 回滚所有超时的空闲事务 */
  private async cleanupIdleTransactions(): Promise<void> {
    const now = Date.now()
    const staleIds: string[] = []
    for (const [id, tx] of this.transactions) {
      if (now - tx.lastActivity > TX_IDLE_TIMEOUT_MS) staleIds.push(id)
    }
    for (const id of staleIds) {
      try { await this.rollback(id) } catch { /* 强制清理，忽略错误 */ }
    }
    if (this.transactions.size === 0) this.stopCleanup()
  }

  /** 全局关闭：回滚所有活跃事务并停止定时器 */
  async shutdown(): Promise<void> {
    const ids = Array.from(this.transactions.keys())
    for (const id of ids) {
      try { await this.rollback(id) } catch { /* 忽略 */ }
    }
    this.stopCleanup()
  }

  async executeBatch(connection: StoredConnection, databaseName: string, sql: string): Promise<QueryExecutionResult> {
    const sessionId = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let active: ActiveTransaction
    if (isMysqlFamily(connection.engine)) {
      await dbWorkerBeginMysqlTx(sessionId, connection, databaseName)
      active = { engine: 'MySQL', sessionId, lastActivity: Date.now() }
    } else if (isPgFamily(connection.engine)) {
      await dbWorkerBeginPgTx(sessionId, connection, databaseName)
      active = { engine: 'PostgreSQL', sessionId, lastActivity: Date.now() }
    } else if (connection.engine === 'SQLite') {
      const handleId = `tx-batch-${sessionId}`
      await sqliteWorkerOpen(connection.host, handleId)
      // 显式开启事务，保证批量语句失败时可回滚（SQLite 默认自动提交）
      await sqliteWorkerExec(handleId, 'BEGIN')
      active = { engine: 'SQLite', handleId, lastActivity: Date.now() }
    } else {
      throw new Error(`${connection.engine} 暂不支持显式事务，请使用单语句执行`)
    }
    this.transactions.set(sessionId, active)
    try {
      const result = await this.execute(sessionId, sql)
      // 批量全部成功则提交、任一失败则回滚，保证事务原子性
      if (active.engine === 'MySQL' || active.engine === 'PostgreSQL') {
        try { await (result.success ? dbWorkerTxCommit(active.sessionId) : dbWorkerTxRollback(active.sessionId)) } catch { /* 可能已结束 */ }
      } else {
        const sqliteActive = active as { engine: 'SQLite'; handleId: string }
        try { await sqliteWorkerExec(sqliteActive.handleId, result.success ? 'COMMIT' : 'ROLLBACK') } catch { /* 忽略 */ }
      }
      return result
    } finally {
      this.transactions.delete(sessionId)
      if (active.engine === 'MySQL' || active.engine === 'PostgreSQL') {
        // commit/rollback 已结束事务连接；若中途异常未结束则强制回滚释放
        try { await dbWorkerTxRollback(active.sessionId) } catch { /* 可能已结束 */ }
      } else {
        try { await sqliteWorkerClose((active as { handleId: string }).handleId) } catch { /* 忽略 */ }
      }
      if (this.transactions.size === 0) this.stopCleanup()
    }
  }

  async begin(sessionId: string, connection: StoredConnection, databaseName: string): Promise<void> {
    if (this.transactions.has(sessionId)) throw new Error('当前查询页已在事务中')
    const now = Date.now()
    if (isMysqlFamily(connection.engine)) {
      await dbWorkerBeginMysqlTx(sessionId, connection, databaseName)
      this.transactions.set(sessionId, { engine: 'MySQL', sessionId, lastActivity: now })
      this.ensureCleanup()
      return
    }
    if (isPgFamily(connection.engine)) {
      await dbWorkerBeginPgTx(sessionId, connection, databaseName)
      this.transactions.set(sessionId, { engine: 'PostgreSQL', sessionId, lastActivity: now })
      this.ensureCleanup()
      return
    }
    if (connection.engine === 'SQLite') {
      const handleId = `tx-${sessionId}`
      await sqliteWorkerOpen(connection.host, handleId)
      await sqliteWorkerExec(handleId, 'BEGIN')
      this.transactions.set(sessionId, { engine: 'SQLite', handleId, lastActivity: now })
      this.ensureCleanup()
      return
    }
    throw new Error(`${connection.engine} 暂不支持显式事务，请使用单语句执行`)
  }

  async execute(sessionId: string, sql: string): Promise<QueryExecutionResult> {
    const transaction = this.transactions.get(sessionId)
    if (!transaction) throw new Error('当前查询页未开启事务')
    this.touch(sessionId)
    const statements = splitSqlStatements(sql)
    const startTime = new Date().toISOString()
    const started = performance.now()
    const results: QueryStatementResult[] = []
    let lastRows: Array<Record<string, unknown>> | undefined
    let lastColumns: string[] | undefined
    let affectedRows = 0
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]
      const statementStarted = performance.now()
      try {
        let rows: Array<Record<string, unknown>> | undefined
        let columns: string[] | undefined
        let affected = 0
        if (transaction.engine === 'MySQL' || transaction.engine === 'PostgreSQL') {
          const result = await dbWorkerTxQuery(transaction.sessionId, statement)
          const extracted = extractResult(result)
          rows = extracted.rows
          columns = extracted.columns
          affected = extracted.affectedRows
        } else {
          const sqliteTx = transaction as { engine: 'SQLite'; handleId: string }
          const result = await sqliteWorkerQuery(sqliteTx.handleId, statement)
          if ('columns' in result && result.columns.length) {
            rows = result.rows.map((row) => ({ ...row }))
            columns = result.columns
          } else {
            affected = 'changes' in result ? result.changes : 0
          }
        }
        if (rows) { lastRows = rows; lastColumns = columns }
        affectedRows += affected
        results.push({ index: index + 1, sql: statement, success: true, message: statementMessage(rows, affected), affectedRows: affected, columns, rows, durationMs: Math.round(performance.now() - statementStarted) })
      } catch (error) {
        const message = error instanceof Error ? error.message : '语句执行失败'
        results.push({ index: index + 1, sql: statement, success: false, message, durationMs: Math.round(performance.now() - statementStarted) })
        return { success: false, message: `第 ${index + 1} 条语句执行失败：${message}`, startTime, endTime: new Date().toISOString(), durationMs: Math.round(performance.now() - started), queryCount: statements.length, successCount: index, errorCount: 1, failedStatementIndex: index + 1, statementResults: results, columns: lastColumns, rows: lastRows, affectedRows }
      }
    }
    return { success: true, message: statements.length > 1 ? `批量执行完成：${statements.length} 条全部成功` : results[0]?.message || '执行成功', startTime, endTime: new Date().toISOString(), durationMs: Math.round(performance.now() - started), queryCount: statements.length, successCount: statements.length, errorCount: 0, statementResults: results, columns: lastColumns, rows: lastRows, affectedRows }
  }

  async commit(sessionId: string): Promise<void> { await this.finish(sessionId, true) }
  async rollback(sessionId: string): Promise<void> { await this.finish(sessionId, false) }

  private async finish(sessionId: string, commit: boolean): Promise<void> {
    const transaction = this.transactions.get(sessionId)
    if (!transaction) throw new Error('当前查询页未开启事务')
    this.transactions.delete(sessionId)
    if (this.transactions.size === 0) this.stopCleanup()
    try {
      if (transaction.engine === 'MySQL' || transaction.engine === 'PostgreSQL') {
        if (commit) await dbWorkerTxCommit(transaction.sessionId)
        else await dbWorkerTxRollback(transaction.sessionId)
      } else {
        const sqliteTx = transaction as { engine: 'SQLite'; handleId: string }
        await sqliteWorkerExec(sqliteTx.handleId, commit ? 'COMMIT' : 'ROLLBACK')
      }
    } finally {
      // 始终释放 SQLite 句柄，避免泄漏
      if (transaction.engine === 'SQLite') {
        try { await sqliteWorkerClose((transaction as { handleId: string }).handleId) } catch { /* 忽略 */ }
      }
    }
  }
}

export const transactionManager = new TransactionManager()
