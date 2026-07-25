import Redis from 'ioredis'
import type {
  DatabaseItem,
  QueryExecutionResult,
  TableDataFilter
} from '@/shared/connections'
import type { AdapterConnection } from './postgresql-adapter'

// ── helpers ────────────────────────────────────────────────────────────

/** 解析 Redis 命令字符串为 [command, ...args] */
const parseRedisCommand = (input: string): { command: string; args: string[] } | null => {
  const trimmed = input.trim()
  if (!trimmed) return null
  const parts: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false } else { current += ch }
    } else if (ch === '"' || ch === "'") {
      inQuote = true
      quoteChar = ch
    } else if (ch === ' ' || ch === '\t') {
      if (current) { parts.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  if (!parts.length) return null
  return { command: parts[0].toUpperCase(), args: parts.slice(1) }
}

/** 将 Redis 返回值转为可显示的行 */
const toRows = (data: unknown): Array<Record<string, unknown>> => {
  if (data === null || data === undefined) return [{ value: '(nil)' }]
  if (typeof data === 'string') return [{ value: data }]
  if (typeof data === 'number') return [{ value: String(data) }]
  if (Buffer.isBuffer(data)) return [{ value: data.toString('utf-8') }]
  if (Array.isArray(data)) {
    if (data.length === 0) return [{ value: '(empty array)' }]
    // 判断是否为 key-value 对（偶数长度且交替 key-value）
    if (data.length % 2 === 0 && data.every((_, i) => i % 2 === 0 ? typeof data[i] === 'string' : true)) {
      const rows: Array<Record<string, unknown>> = []
      for (let i = 0; i < data.length; i += 2) {
        rows.push({ field: data[i], value: data[i + 1] })
      }
      return rows
    }
    return data.map((item, idx) => ({ index: idx, value: typeof item === 'object' ? JSON.stringify(item) : String(item) }))
  }
  if (typeof data === 'object') return [{ value: JSON.stringify(data, null, 2) }]
  return [{ value: String(data) }]
}

// ── Redis client cache ────────────────────────────────────────────────

const redisClients = new Map<string, Redis>()

const getRedisClient = async (connection: AdapterConnection): Promise<Redis> => {
  const key = `${connection.host}:${connection.port}:${connection.defaultDatabase}`
  const existing = redisClients.get(key)
  if (existing?.status === 'ready') return existing

  const dbIndex = parseInt(connection.defaultDatabase || '0', 10) || 0
  const redis = new Redis({
    host: connection.host,
    port: connection.port || 6379,
    password: connection.password || undefined,
    db: dbIndex,
    connectTimeout: 5000,
    commandTimeout: 30000,
    lazyConnect: true,
    tls: connection.sslEnabled ? {} : undefined
  })
  await redis.connect()
  redisClients.set(key, redis)
  return redis
}

export const closeRedisClient = async (connection: AdapterConnection): Promise<void> => {
  const prefix = `${connection.host}:${connection.port}`
  for (const [key, client] of redisClients) {
    if (key.startsWith(prefix)) {
      try { await client.quit() } catch { try { client.disconnect() } catch { /* ignore */ } }
      redisClients.delete(key)
    }
  }
}

// ── Redis functions ───────────────────────────────────────────────────

export const readRedisDatabases = async (connection: AdapterConnection): Promise<DatabaseItem[]> => {
  const client = await getRedisClient(connection)
  const dbIndex = connection.defaultDatabase || 'db0'
  const info = await client.info('keyspace')
  const dbNames: string[] = []
  const lines = info.split('\n')
  for (const line of lines) {
    const match = line.match(/^db(\d+)/)
    if (match) dbNames.push(`db${match[1]}`)
  }
  if (!dbNames.length) dbNames.push(dbIndex.startsWith('db') ? dbIndex : `db${dbIndex}`)

  return dbNames.map((name) => ({
    name,
    charset: 'utf8',
    collation: '',
    tables: [],
    views: [],
    functions: [],
    procedures: [],
    indexes: [],
    triggers: []
  }))
}

export const executeRedisCommand = async (connection: AdapterConnection, databaseName: string, commandText: string): Promise<QueryExecutionResult> => {
  const client = await getRedisClient(connection)
  const startTime = new Date().toISOString()
  const startMs = performance.now()

  try {
    // 切换数据库
    if (databaseName) {
      const dbNum = parseInt(databaseName.replace('db', ''), 10)
      if (!isNaN(dbNum)) {
        try { await client.select(dbNum) } catch { /* ignore */ }
      }
    }

    const parsed = parseRedisCommand(commandText)
    if (!parsed) {
      return { success: false, message: '无法解析 Redis 命令', startTime, endTime: new Date().toISOString(), durationMs: Math.round(performance.now() - startMs), queryCount: 1, successCount: 0, errorCount: 1 }
    }

    const { command, args } = parsed
    const result = await client.call(command, ...args) as unknown
    const rows = toRows(result)
    const columns = rows.length > 0 ? Object.keys(rows[0]) : ['value']
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)

    return {
      success: true,
      message: `命令执行成功，返回 ${rows.length} 条结果`,
      columns,
      rows,
      startTime,
      endTime,
      durationMs,
      queryCount: 1,
      successCount: 1,
      errorCount: 0
    }
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return {
      success: false,
      message: error instanceof Error ? error.message : '命令执行失败',
      startTime,
      endTime,
      durationMs,
      queryCount: 1,
      successCount: 0,
      errorCount: 1
    }
  }
}

export const readRedisTableData = async (
  connection: AdapterConnection,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  _filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  const client = await getRedisClient(connection)
  const startTime = new Date().toISOString()
  const startMs = performance.now()

  try {
    if (databaseName) {
      const dbNum = parseInt(databaseName.replace('db', ''), 10)
      if (!isNaN(dbNum)) {
        try { await client.select(dbNum) } catch { /* ignore */ }
      }
    }

    // tableName 作为 key pattern
    const pattern = tableName === '*' ? '*' : `*${tableName}*`
    const allKeys = await client.keys(pattern)
    const slicedKeys = allKeys.slice(offset, offset + limit)

    if (!slicedKeys.length) {
      return {
        success: true,
        message: '没有找到匹配的键',
        columns: ['key', 'type', 'ttl', 'value'],
        rows: [],
        startTime,
        endTime: new Date().toISOString(),
        durationMs: Math.round(performance.now() - startMs),
        queryCount: 1,
        successCount: 1,
        errorCount: 0
      }
    }

    const rows: Array<Record<string, unknown>> = []
    for (const key of slicedKeys) {
      const type = await client.type(key)
      const ttl = await client.ttl(key)
      let value: string
      switch (type) {
        case 'string': value = await client.get(key) ?? ''; break
        case 'list': value = JSON.stringify(await client.lrange(key, 0, 9)); break
        case 'set': value = JSON.stringify(await client.smembers(key)); break
        case 'zset': {
          const members = await client.zrange(key, 0, 9, 'WITHSCORES')
          value = JSON.stringify(members)
          break
        }
        case 'hash': {
          const hash = await client.hgetall(key)
          value = JSON.stringify(hash)
          break
        }
        case 'stream': value = '(stream)'; break
        default: value = `(${type})`
      }
      rows.push({ key, type, ttl: ttl > 0 ? `${ttl}s` : 'no expire', value })
    }

    return {
      success: true,
      message: `已加载 ${rows.length} 个键`,
      columns: ['key', 'type', 'ttl', 'value'],
      rows,
      startTime,
      endTime: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startMs),
      queryCount: 1,
      successCount: 1,
      errorCount: 0
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '读取数据失败',
      startTime,
      endTime: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startMs),
      queryCount: 1,
      successCount: 0,
      errorCount: 1
    }
  }
}

export const getRedisServerInfo = async (connection: AdapterConnection): Promise<QueryExecutionResult> => {
  const client = await getRedisClient(connection)
  const startTime = new Date().toISOString()
  const startMs = performance.now()

  try {
    const [info, dbsize, _memory] = await Promise.all([
      client.info(),
      client.dbsize(),
      client.call('MEMORY', 'USAGE', '__nonexistent__') as Promise<unknown>
    ])

    const infoLines = info.split('\r\n').filter((l) => l.includes(':'))
    const infoMap: Record<string, string> = {}
    for (const line of infoLines) {
      const [key, ...rest] = line.split(':')
      infoMap[key] = rest.join(':')
    }

    return {
      success: true,
      message: `Redis 服务器信息，共 ${dbsize} 个键`,
      columns: ['property', 'value'],
      rows: [
        { property: 'redis_version', value: infoMap.redis_version || 'unknown' },
        { property: 'os', value: infoMap.os || 'unknown' },
        { property: 'arch_bits', value: infoMap.arch_bits || 'unknown' },
        { property: 'tcp_port', value: infoMap.tcp_port || '6379' },
        { property: 'connected_clients', value: infoMap.connected_clients || '0' },
        { property: 'used_memory_human', value: infoMap.used_memory_human || '0' },
        { property: 'used_memory_peak_human', value: infoMap.used_memory_peak_human || '0' },
        { property: 'total_connections_received', value: infoMap.total_connections_received || '0' },
        { property: 'total_commands_processed', value: infoMap.total_commands_processed || '0' },
        { property: 'keyspace_hits', value: infoMap.keyspace_hits || '0' },
        { property: 'keyspace_misses', value: infoMap.keyspace_misses || '0' },
        { property: 'uptime_in_seconds', value: infoMap.uptime_in_seconds || '0' },
        { property: 'uptime_in_days', value: infoMap.uptime_in_days || '0' },
        { property: 'hz', value: infoMap.hz || '10' },
        { property: 'db_count', value: String(dbsize) }
      ],
      startTime,
      endTime: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startMs),
      queryCount: 1,
      successCount: 1,
      errorCount: 0
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '获取服务器信息失败',
      startTime,
      endTime: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startMs),
      queryCount: 1,
      successCount: 0,
      errorCount: 1
    }
  }
}
