/**
 * MySQL / PostgreSQL Worker 线程 (P1)
 * 将连接池管理、查询执行、事务处理迁移到独立线程，
 * 避免主进程事件循环被大量数据库 I/O 或结果序列化阻塞。
 */
import { parentPort } from 'node:worker_threads'
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { Pool as PgPool, Client as PgClient } from 'pg'

// ── SSL 配置构建（与 ssl-helper.ts 逻辑一致） ─────────────────────────
interface SslConfig {
  sslEnabled: boolean
  sslRejectUnauthorized: boolean
  sslCaPath: string
  sslCertPath: string
  sslKeyPath: string
}

const readOptionalFile = (path: string): Buffer | undefined => path?.trim() ? readFileSync(path.trim()) : undefined

const buildSsl = (config: SslConfig): { rejectUnauthorized: boolean; ca?: Buffer; cert?: Buffer; key?: Buffer } | undefined => {
  if (!config.sslEnabled) return undefined
  return {
    rejectUnauthorized: config.sslRejectUnauthorized,
    ca: readOptionalFile(config.sslCaPath),
    cert: readOptionalFile(config.sslCertPath),
    key: readOptionalFile(config.sslKeyPath)
  }
}

// ── 连接池管理 ──────────────────────────────────────────────────────────
const mysqlPools = new Map<string, mysql.Pool>()
const pgPools = new Map<string, PgPool>()

const getMysqlPool = (poolKey: string, config: SslConfig & { host: string; port: number; username: string; password: string }, databaseName: string): mysql.Pool => {
  const key = `${poolKey}/${databaseName}`
  let pool = mysqlPools.get(key)
  if (!pool) {
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: databaseName,
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 5000,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true,
      ssl: buildSsl(config)
    })
    mysqlPools.set(key, pool)
  }
  return pool
}

const getPgPool = (poolKey: string, config: SslConfig & { host: string; port: number; username: string; password: string; defaultDatabase?: string }, databaseName: string): PgPool => {
  const dbName = databaseName || config.defaultDatabase || 'postgres'
  const key = `${poolKey}/${dbName}`
  let pool = pgPools.get(key)
  if (!pool) {
    pool = new PgPool({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      database: dbName,
      max: 5,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 5000,
      ssl: buildSsl(config) as any
    })
    pgPools.set(key, pool)
  }
  return pool
}

// ── 事务连接管理 ─────────────────────────────────────────────────────────
type TxConnection =
  | { engine: 'MySQL'; connection: mysql.PoolConnection }
  | { engine: 'PostgreSQL'; client: PgClient }

const txConnections = new Map<string, TxConnection>()

// ── 消息处理 ────────────────────────────────────────────────────────────
async function handleMessage(type: string, payload: Record<string, unknown>): Promise<unknown> {
  switch (type) {
    case 'mysql-query': {
      const { poolKey, config, databaseName, sql, params } = payload as {
        poolKey: string; config: SslConfig & { host: string; port: number; username: string; password: string }; databaseName: string; sql: string; params?: unknown[]
      }
      const pool = getMysqlPool(poolKey, config, databaseName)
      const [result, fields] = params ? await pool.query(sql, params) : await pool.query(sql)
      if (Array.isArray(result)) {
        return {
          type: 'rows',
          rows: result.map((row) => ({ ...(row as Record<string, unknown>) })),
          columns: fields.map((f) => f.name),
          fields: fields.map((f) => ({
            name: f.name,
            orgName: f.orgName ?? f.name,
            table: typeof f.table === 'object' && f.table ? (f.table as any).name ?? '' : (typeof f.table === 'string' ? f.table : ''),
            orgTable: f.orgTable ?? (typeof f.table === 'object' && f.table ? (f.table as any).name ?? '' : (typeof f.table === 'string' ? f.table : ''))
          }))
        }
      }
      return {
        type: 'result',
        affectedRows: 'affectedRows' in result ? Number((result as any).affectedRows) : 0
      }
    }

    case 'pg-query': {
      const { poolKey, config, databaseName, sql, params } = payload as {
        poolKey: string; config: SslConfig & { host: string; port: number; username: string; password: string; defaultDatabase?: string }; databaseName: string; sql: string; params?: unknown[]
      }
      const pool = getPgPool(poolKey, config, databaseName)
      const client = await pool.connect()
      try {
        const result = params ? await client.query(sql, params) : await client.query(sql)
        if (result.fields.length) {
          return {
            type: 'rows',
            rows: result.rows.map((row) => ({ ...row })),
            columns: result.fields.map((f) => f.name),
            fields: result.fields.map((f) => ({
              name: f.name,
              tableID: f.tableID,
              columnID: f.columnID
            })),
            rowCount: result.rowCount
          }
        }
        return { type: 'result', rowCount: result.rowCount ?? 0 }
      } finally {
        client.release()
      }
    }

    case 'mysql-begin-tx': {
      const { sessionId, config, databaseName } = payload as {
        sessionId: string; config: SslConfig & { host: string; port: number; username: string; password: string }; databaseName: string
      }
      const pool = getMysqlPool(`${config.host}:${config.port}:${config.username}`, config, databaseName)
      const connection = await pool.getConnection()
      await connection.beginTransaction()
      txConnections.set(sessionId, { engine: 'MySQL', connection })
      return undefined
    }

    case 'pg-begin-tx': {
      const { sessionId, config, databaseName } = payload as {
        sessionId: string; config: SslConfig & { host: string; port: number; username: string; password: string; defaultDatabase?: string }; databaseName: string
      }
      const client = new PgClient({
        host: config.host, port: config.port, user: config.username, password: config.password,
        database: databaseName || config.defaultDatabase || 'postgres',
        connectionTimeoutMillis: 5000,
        ssl: buildSsl(config) as any
      })
      await client.connect()
      await client.query('BEGIN')
      txConnections.set(sessionId, { engine: 'PostgreSQL', client })
      return undefined
    }

    case 'tx-query': {
      const { sessionId, sql } = payload as { sessionId: string; sql: string }
      const tx = txConnections.get(sessionId)
      if (!tx) throw new Error(`事务会话 "${sessionId}" 不存在`)
      if (tx.engine === 'MySQL') {
        const [result, fields] = await tx.connection.query(sql)
        if (Array.isArray(result)) {
          return {
            type: 'rows',
            rows: result.map((row) => ({ ...(row as Record<string, unknown>) })),
            columns: fields.map((f) => f.name),
            fields: fields.map((f) => ({
              name: f.name,
              orgName: f.orgName ?? f.name,
              table: typeof f.table === 'object' && f.table ? (f.table as any).name ?? '' : (typeof f.table === 'string' ? f.table : ''),
              orgTable: f.orgTable ?? (typeof f.table === 'object' && f.table ? (f.table as any).name ?? '' : (typeof f.table === 'string' ? f.table : ''))
            }))
          }
        }
        return { type: 'result', affectedRows: 'affectedRows' in result ? Number((result as any).affectedRows) : 0 }
      }
      const pgResult = await tx.client.query(sql)
      if (pgResult.fields.length) {
        return {
          type: 'rows',
          rows: pgResult.rows.map((row) => ({ ...row })),
          columns: pgResult.fields.map((f) => f.name),
          fields: pgResult.fields.map((f) => ({ name: f.name, tableID: f.tableID, columnID: f.columnID })),
          rowCount: pgResult.rowCount
        }
      }
      return { type: 'result', rowCount: pgResult.rowCount ?? 0 }
    }

    case 'tx-commit': {
      const { sessionId } = payload as { sessionId: string }
      const tx = txConnections.get(sessionId)
      if (!tx) throw new Error(`事务会话 "${sessionId}" 不存在`)
      if (tx.engine === 'MySQL') {
        await tx.connection.commit()
        await tx.connection.end()
      } else {
        await tx.client.query('COMMIT')
        await tx.client.end()
      }
      txConnections.delete(sessionId)
      return undefined
    }

    case 'tx-rollback': {
      const { sessionId } = payload as { sessionId: string }
      const tx = txConnections.get(sessionId)
      if (!tx) throw new Error(`事务会话 "${sessionId}" 不存在`)
      if (tx.engine === 'MySQL') {
        await tx.connection.rollback()
        await tx.connection.end()
      } else {
        await tx.client.query('ROLLBACK')
        await tx.client.end()
      }
      txConnections.delete(sessionId)
      return undefined
    }

    case 'close-pools': {
      const { prefix, engine } = payload as { prefix: string; engine: 'mysql' | 'pg' }
      if (engine === 'mysql') {
        for (const [key, pool] of mysqlPools) {
          if (key.startsWith(prefix)) { await pool.end(); mysqlPools.delete(key) }
        }
      } else {
        for (const [key, pool] of pgPools) {
          if (key.startsWith(prefix)) { await pool.end(); pgPools.delete(key) }
        }
      }
      return undefined
    }

    case 'close-all': {
      for (const [, pool] of mysqlPools) await pool.end().catch(() => undefined)
      mysqlPools.clear()
      for (const [, pool] of pgPools) await pool.end().catch(() => undefined)
      pgPools.clear()
      for (const [, tx] of txConnections) {
        try { if (tx.engine === 'MySQL') await tx.connection.end(); else await tx.client.end() } catch { /* ignore */ }
      }
      txConnections.clear()
      return undefined
    }

    default:
      throw new Error(`未知的 Worker 操作类型: ${type}`)
  }
}

if (parentPort) {
  parentPort.on('message', async (msg: { id: number; type: string; payload: Record<string, unknown> }) => {
    try {
      const result = await handleMessage(msg.type, msg.payload)
      parentPort!.postMessage({ id: msg.id, ok: true, result })
    } catch (error) {
      parentPort!.postMessage({ id: msg.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
