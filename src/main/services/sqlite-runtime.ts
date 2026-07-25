import { WorkerProxy } from './worker-proxy'

// ── Worker 线程代理 (P1-2) ─────────────────────────────────────────────
// 所有 SQLite 同步操作通过 Worker 线程异步执行，避免阻塞主进程事件循环。

export interface SqliteWorkerQueryResult {
  columns: string[]
  rows: Array<Record<string, unknown>>
}

export interface SqliteWorkerRunResult {
  changes: number
}

export interface SqliteWorkerExportResult {
  filePath: string
  totalLength: number
}

const progressListeners = new Map<string, (progress: { current: number; total: number; tableName?: string; message: string }) => void>()

const proxy = new WorkerProxy('sqlite-worker.js', (msg) => {
  // 进度回调消息（id === -1）
  if (msg.id === -1 && msg.type === 'progress' && msg.payload) {
    const exportKey = msg.payload['filePath' as string] as string | undefined
    if (exportKey) {
      const listener = progressListeners.get(exportKey)
      listener?.(msg.payload as { current: number; total: number; tableName?: string; message: string })
    }
    return true // 已处理，不再走请求-响应流程
  }
  return false
})

/** 注册导出进度监听器 */
export const onSqliteExportProgress = (
  filePath: string,
  callback: (progress: { current: number; total: number; tableName?: string; message: string }) => void
): void => {
  progressListeners.set(filePath, callback)
}

/** 移除导出进度监听器 */
export const offSqliteExportProgress = (filePath: string): void => {
  progressListeners.delete(filePath)
}

// ── 对外暴露的异步 API ─────────────────────────────────────────────────

/** 打开 SQLite 数据库（在 Worker 中创建句柄） */
export const sqliteWorkerOpen = async (filePath: string, handleId: string): Promise<void> => {
  await proxy.send('open', { filePath, handleId })
}

/** 关闭 SQLite 数据库（在 Worker 中释放句柄） */
export const sqliteWorkerClose = async (handleId: string): Promise<void> => {
  await proxy.send('close', { handleId })
}

/** 执行 SQL（无返回值，如 DDL / PRAGMA） */
export const sqliteWorkerExec = async (handleId: string, sql: string): Promise<void> => {
  await proxy.send('exec', { handleId, sql })
}

/** 查询：自动判断 SELECT / 写操作，返回行+列 或 changes */
export const sqliteWorkerQuery = async (handleId: string, sql: string, params: unknown[] = []): Promise<SqliteWorkerQueryResult | SqliteWorkerRunResult> => {
  return proxy.send<SqliteWorkerQueryResult | SqliteWorkerRunResult>('query', { handleId, sql, params })
}

/** 获取单行结果 */
export const sqliteWorkerGet = async <T = unknown>(handleId: string, sql: string, params: unknown[] = []): Promise<T | undefined> => {
  return proxy.send<T | undefined>('get', { handleId, sql, params })
}

/** 获取所有行 */
export const sqliteWorkerAll = async <T = unknown>(handleId: string, sql: string, params: unknown[] = []): Promise<T[]> => {
  return proxy.send<T[]>('all', { handleId, sql, params })
}

/** 在 Worker 内执行导出（边生成边写文件，不回传大字符串） */
export const sqliteWorkerExport = async (
  handleId: string,
  tableNames: string[],
  includeData: boolean,
  filePath: string
): Promise<SqliteWorkerExportResult> => {
  return proxy.send<SqliteWorkerExportResult>('export', { handleId, tableNames, includeData, filePath })
}

/** 关闭 Worker 线程（应用退出时调用） */
export const shutdownSqliteWorker = async (): Promise<void> => {
  await proxy.shutdown()
  progressListeners.clear()
}

// ── 保留旧接口兼容（用于类型导出） ────────────────────────────────────

export interface SqliteStatement {
  all: (...values: unknown[]) => unknown[]
  columns: () => Array<{ name: string; column?: string; database?: string; table?: string; type?: string | null }>
  get: (...values: unknown[]) => unknown
  run: (...values: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint }
}

export interface SqliteDatabase {
  close: () => void
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
}

import { createRequire } from 'node:module'

const originalEmitWarning = process.emitWarning
process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning?.message
  if (message?.includes('SQLite is an experimental feature')) return
  return (originalEmitWarning as Function).call(process, warning, ...args)
}

// Compute the module id so bundling cannot move node:sqlite above the filter.
const sqliteModuleId = ['node', 'sqlite'].join(':')
export const { DatabaseSync } = createRequire(import.meta.url)(sqliteModuleId) as {
  DatabaseSync: new (path: string) => SqliteDatabase
}
