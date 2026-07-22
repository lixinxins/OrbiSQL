import { createConnection } from 'mysql2/promise'
import { Client } from 'pg'
import type { QueryExecutionResult, QueryStatementResult } from '../../shared/connections'
import type { StoredConnection } from '../database/connection-repository'
import { buildSslConfig } from './ssl-helper'
import { splitSqlStatements } from './sql-statement-splitter'
import { DatabaseSync, type SqliteDatabase } from './sqlite-runtime'

type MysqlConnection = Awaited<ReturnType<typeof createConnection>>
type ActiveTransaction =
  | { engine: 'MySQL'; connection: MysqlConnection }
  | { engine: 'PostgreSQL'; connection: Client }
  | { engine: 'SQLite'; connection: SqliteDatabase }

const statementMessage = (rows: Array<Record<string, unknown>> | undefined, affectedRows: number): string =>
  rows ? `查询成功，共 ${rows.length} 行` : `执行成功，影响 ${affectedRows} 行`

export class TransactionManager {
  private readonly transactions = new Map<string, ActiveTransaction>()

  has(sessionId: string): boolean { return this.transactions.has(sessionId) }

  async executeBatch(connection: StoredConnection, databaseName: string, sql: string): Promise<QueryExecutionResult> {
    const sessionId = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let active: ActiveTransaction
    if (connection.engine === 'MySQL') {
      active = { engine: 'MySQL', connection: await createConnection({
        host: connection.host, port: connection.port, user: connection.username, password: connection.password,
        database: databaseName, connectTimeout: 5000, multipleStatements: false,
        supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, ssl: buildSslConfig(connection)
      }) }
    } else if (connection.engine === 'PostgreSQL') {
      const client = new Client({
        host: connection.host, port: connection.port, user: connection.username, password: connection.password,
        database: databaseName || connection.defaultDatabase || 'postgres', connectionTimeoutMillis: 5000,
        ssl: buildSslConfig(connection)
      })
      await client.connect()
      active = { engine: 'PostgreSQL', connection: client }
    } else {
      const database = new DatabaseSync(connection.host)
      database.exec('PRAGMA foreign_keys=ON')
      active = { engine: 'SQLite', connection: database }
    }
    this.transactions.set(sessionId, active)
    try {
      return await this.execute(sessionId, sql)
    } finally {
      this.transactions.delete(sessionId)
      if (active.engine === 'MySQL') await active.connection.end()
      else if (active.engine === 'PostgreSQL') await active.connection.end()
      else active.connection.close()
    }
  }

  async begin(sessionId: string, connection: StoredConnection, databaseName: string): Promise<void> {
    if (this.transactions.has(sessionId)) throw new Error('当前查询页已在事务中')
    if (connection.engine === 'MySQL') {
      const client = await createConnection({
        host: connection.host, port: connection.port, user: connection.username, password: connection.password,
        database: databaseName, connectTimeout: 5000, multipleStatements: false,
        supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, ssl: buildSslConfig(connection)
      })
      await client.beginTransaction()
      this.transactions.set(sessionId, { engine: 'MySQL', connection: client })
      return
    }
    if (connection.engine === 'PostgreSQL') {
      const client = new Client({
        host: connection.host, port: connection.port, user: connection.username, password: connection.password,
        database: databaseName || connection.defaultDatabase || 'postgres', connectionTimeoutMillis: 5000,
        ssl: buildSslConfig(connection)
      })
      await client.connect()
      await client.query('BEGIN')
      this.transactions.set(sessionId, { engine: 'PostgreSQL', connection: client })
      return
    }
    const database = new DatabaseSync(connection.host)
    database.exec('PRAGMA foreign_keys=ON; BEGIN')
    this.transactions.set(sessionId, { engine: 'SQLite', connection: database })
  }

  async execute(sessionId: string, sql: string): Promise<QueryExecutionResult> {
    const transaction = this.transactions.get(sessionId)
    if (!transaction) throw new Error('当前查询页未开启事务')
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
        if (transaction.engine === 'MySQL') {
          const [value, fields] = await transaction.connection.query(statement)
          if (Array.isArray(value)) {
            rows = value.map((row) => ({ ...(row as Record<string, unknown>) }))
            columns = fields.map((field) => field.name)
          } else affected = 'affectedRows' in value ? Number(value.affectedRows) : 0
        } else if (transaction.engine === 'PostgreSQL') {
          const value = await transaction.connection.query(statement)
          if (value.fields.length) {
            rows = value.rows.map((row) => ({ ...row }))
            columns = value.fields.map((field) => field.name)
          } else affected = value.rowCount ?? 0
        } else {
          const prepared = transaction.connection.prepare(statement)
          if (prepared.columns().length) {
            rows = prepared.all() as Array<Record<string, unknown>>
            columns = prepared.columns().map((column) => column.name)
          } else affected = Number(prepared.run().changes)
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
    if (transaction.engine === 'MySQL') {
      try { commit ? await transaction.connection.commit() : await transaction.connection.rollback() } finally { await transaction.connection.end() }
    } else if (transaction.engine === 'PostgreSQL') {
      try { await transaction.connection.query(commit ? 'COMMIT' : 'ROLLBACK') } finally { await transaction.connection.end() }
    } else {
      try { transaction.connection.exec(commit ? 'COMMIT' : 'ROLLBACK') } finally { transaction.connection.close() }
    }
  }
}

export const transactionManager = new TransactionManager()
