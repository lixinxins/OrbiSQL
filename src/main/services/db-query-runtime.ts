import { WorkerProxy } from './worker-proxy'

// ── MySQL / PostgreSQL Worker 线程代理 (P1) ─────────────────────────────
// 所有 MySQL/PG 连接池管理、查询执行、事务处理通过 Worker 线程异步执行。

export interface DbWorkerFieldDetail {
  name: string
  orgName?: string
  tableID?: number
  columnID?: number
  table?: string
  orgTable?: string
}

export interface DbWorkerRowsResult {
  type: 'rows'
  rows: Array<Record<string, unknown>>
  columns: string[]
  fields: DbWorkerFieldDetail[]
  rowCount?: number
}

export interface DbWorkerAffectedResult {
  type: 'result'
  affectedRows?: number
  rowCount?: number
}

export type DbWorkerQueryResult = DbWorkerRowsResult | DbWorkerAffectedResult

const proxy = new WorkerProxy('db-query-worker.js')

// ── 对外暴露的异步 API ─────────────────────────────────────────────────

/** MySQL 查询 */
export const dbWorkerMysqlQuery = async (
  poolKey: string,
  config: { id?: number; host: string; port: number; username: string; password: string; sslEnabled: boolean; sslRejectUnauthorized: boolean; sslCaPath: string; sslCertPath: string; sslKeyPath: string },
  databaseName: string,
  sql: string,
  params?: unknown[]
): Promise<DbWorkerQueryResult> => {
  return proxy.send<DbWorkerQueryResult>('mysql-query', { poolKey, config, databaseName, sql, params })
}

/** PostgreSQL 查询 */
export const dbWorkerPgQuery = async (
  poolKey: string,
  config: { id?: number; host: string; port: number; username: string; password: string; defaultDatabase?: string; sslEnabled: boolean; sslRejectUnauthorized: boolean; sslCaPath: string; sslCertPath: string; sslKeyPath: string },
  databaseName: string,
  sql: string,
  params?: unknown[]
): Promise<DbWorkerQueryResult> => {
  return proxy.send<DbWorkerQueryResult>('pg-query', { poolKey, config, databaseName, sql, params })
}

/** 开启 MySQL 事务 */
export const dbWorkerBeginMysqlTx = async (
  sessionId: string,
  config: { host: string; port: number; username: string; password: string; sslEnabled: boolean; sslRejectUnauthorized: boolean; sslCaPath: string; sslCertPath: string; sslKeyPath: string },
  databaseName: string
): Promise<void> => {
  await proxy.send<void>('mysql-begin-tx', { sessionId, config, databaseName })
}

/** 开启 PostgreSQL 事务 */
export const dbWorkerBeginPgTx = async (
  sessionId: string,
  config: { host: string; port: number; username: string; password: string; defaultDatabase?: string; sslEnabled: boolean; sslRejectUnauthorized: boolean; sslCaPath: string; sslCertPath: string; sslKeyPath: string },
  databaseName: string
): Promise<void> => {
  await proxy.send<void>('pg-begin-tx', { sessionId, config, databaseName })
}

/** 在事务中执行查询 */
export const dbWorkerTxQuery = async (sessionId: string, sql: string): Promise<DbWorkerQueryResult> => {
  return proxy.send<DbWorkerQueryResult>('tx-query', { sessionId, sql })
}

/** 提交事务 */
export const dbWorkerTxCommit = async (sessionId: string): Promise<void> => {
  await proxy.send<void>('tx-commit', { sessionId })
}

/** 回滚事务 */
export const dbWorkerTxRollback = async (sessionId: string): Promise<void> => {
  await proxy.send<void>('tx-rollback', { sessionId })
}

/** 关闭指定引擎的连接池 */
export const dbWorkerClosePools = async (prefix: string, engine: 'mysql' | 'pg'): Promise<void> => {
  await proxy.send<void>('close-pools', { prefix, engine })
}

/** 关闭所有连接池和事务连接 */
export const dbWorkerCloseAll = async (): Promise<void> => {
  await proxy.send<void>('close-all', {})
}

/** 关闭 Worker 线程 */
export const shutdownDbQueryWorker = async (): Promise<void> => {
  await proxy.shutdown()
}
