import { MongoClient, ObjectId, type Document, type Sort } from 'mongodb'
import {
  QUERY_ROW_LIMIT,
  createCursor,
  updateCursorOffset,
  deleteCursor
} from '../query-cursor-manager'
import type { QueryCursor } from '../query-cursor-manager'
import type {
  ConnectionActionResult,
  DatabaseItem,
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput,
  TableDataFilter,
  TableDataFilterCondition,
  TableDefinitionResult,
  MySQLColumnType
} from '@/shared/connections'
import type { AdapterConnection } from './postgresql-adapter'

// ── helpers ────────────────────────────────────────────────────────────

const mongoTypeToColumnType = (val: unknown): MySQLColumnType => {
  if (val === null || val === undefined) return 'TEXT'
  if (typeof val === 'number') return Number.isInteger(val) ? 'BIGINT' : 'DOUBLE'
  if (typeof val === 'boolean') return 'BOOLEAN'
  if (typeof val === 'string') return 'VARCHAR'
  if (val instanceof Date) return 'DATETIME'
  if (val instanceof ObjectId) return 'VARCHAR'
  if (Buffer.isBuffer(val)) return 'BLOB'
  if (Array.isArray(val)) return 'JSON'
  if (typeof val === 'object') return 'JSON'
  return 'TEXT'
}

/** 转义正则特殊字符，防止用户输入导致 ReDoS 或语法报错 */
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 仅当为纯数字字面量时才转为 number，避免前导零字符串（如 "0123"）
 * 与科学计数法（如 "1e2"）被误转为数字而失真。
 */
const toNumericIfPureNumber = (v: string): string | number => {
  const trimmed = v.trim()
  if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed)
    if (!isNaN(num)) return num
  }
  return v
}

const buildFilter = (filter: TableDataFilter): Record<string, unknown> => {
  const buildOne = (cond: TableDataFilterCondition): Record<string, unknown> => {
    const col = cond.column
    const v = cond.value
    const numVal = toNumericIfPureNumber(v)
    switch (cond.operator) {
      case 'equals': return { [col]: numVal }
      case 'notEquals': return { [col]: { $ne: numVal } }
      case 'contains': return { [col]: { $regex: escapeRegex(v), $options: 'i' } }
      case 'startsWith': return { [col]: { $regex: '^' + escapeRegex(v), $options: 'i' } }
      case 'greaterThan': return { [col]: { $gt: numVal } }
      case 'greaterThanOrEqual': return { [col]: { $gte: numVal } }
      case 'lessThan': return { [col]: { $lt: numVal } }
      case 'lessThanOrEqual': return { [col]: { $lte: numVal } }
      case 'isEmpty': return { [col]: '' }
      case 'isEmptyOrNull': return { $or: [{ [col]: '' }, { [col]: null }] }
      case 'isNotEmpty': return { $and: [{ [col]: { $exists: true } }, { [col]: { $ne: '' } }] }
      case 'isNull': return { [col]: null }
      case 'isNotNull': return { [col]: { $ne: null } }
      default: return {}
    }
  }
  const parts = filter.filters.filter((cond) => cond.column).map(buildOne)
  if (parts.length <= 1) return parts[0] ?? {}
  return filter.logic === 'OR' ? { $or: parts } : { $and: parts }
}

/** 将 MongoDB 文档中的特殊类型转为可序列化值 */
const serializeDoc = (doc: Document): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(doc)) {
    if (val instanceof ObjectId) out[key] = val.toHexString()
    else if (val instanceof Date) out[key] = val.toISOString()
    else if (Buffer.isBuffer(val)) out[key] = `<Buffer ${val.length} bytes>`
    else out[key] = val
  }
  return out
}

/** 尝试将用户输入的 JSON 字符串解析为 MongoDB 查询对象 */
const parseMongoQuery = (text: string): { filter: Record<string, unknown>; options?: Record<string, unknown> } | null => {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null) return null
    if (parsed.filter && typeof parsed.filter === 'object') return parsed
    return { filter: parsed }
  } catch {
    return null
  }
}

// ── MongoDB client cache ──────────────────────────────────────────────

const mongoClients = new Map<string, MongoClient>()
const mongoLastAccess = new Map<string, number>()

const getMongoClient = async (connection: AdapterConnection): Promise<MongoClient> => {
  const key = connection.id != null && connection.id > 0
    ? `id:${connection.id}`
    : `${connection.host}:${connection.port}:${connection.username}`
  const existing = mongoClients.get(key)
  if (existing) { mongoLastAccess.set(key, Date.now()); return existing }

  const authSource = connection.defaultDatabase || 'admin'
  let uri: string
  if (connection.username) {
    const user = encodeURIComponent(connection.username)
    const pass = encodeURIComponent(connection.password || '')
    uri = `mongodb://${user}:${pass}@${connection.host}:${connection.port || 27017}/${authSource}?authMechanism=SCRAM-SHA-256`
  } else {
    uri = `mongodb://${connection.host}:${connection.port || 27017}`
  }
  if (connection.sslEnabled) {
    uri += `${uri.includes('?') ? '&' : '?'}tls=true`
    if (!connection.sslRejectUnauthorized) uri += '&tlsAllowInvalidCertificates=true'
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000
  })
  await client.connect()
  mongoClients.set(key, client)
  mongoLastAccess.set(key, Date.now())
  return client
}

export const closeMongoClients = async (connection: AdapterConnection): Promise<void> => {
  const prefix = connection.id != null && connection.id > 0
    ? `id:${connection.id}`
    : `${connection.host}:${connection.port}:${connection.username}`
  for (const [key, client] of mongoClients) {
    if (key === prefix) {
      try { await client.close() } catch { /* ignore */ }
      mongoClients.delete(key)
    }
  }
}

/** 驱逐空闲超过 maxIdleMs 的客户端 */
export const evictIdleMongoClients = async (maxIdleMs: number): Promise<void> => {
  const now = Date.now()
  for (const [key, client] of mongoClients) {
    if (now - (mongoLastAccess.get(key) ?? 0) > maxIdleMs) {
      try { await client.close() } catch { /* ignore */ }
      mongoClients.delete(key)
      mongoLastAccess.delete(key)
    }
  }
}

// ── MongoDB functions ─────────────────────────────────────────────────

export const readMongoDatabases = async (connection: AdapterConnection, options?: { light?: boolean }): Promise<DatabaseItem[]> => {
  const client = await getMongoClient(connection)
  const admin = client.db('admin').admin()
  const { databases } = await admin.listDatabases()

  const items: DatabaseItem[] = []
  for (const dbInfo of databases) {
    if (options?.light) {
      const db = client.db(dbInfo.name)
      const collections = await db.listCollections().toArray()
      items.push({
        name: dbInfo.name,
        charset: 'utf8',
        collation: '',
        tables: collections.map((c) => ({
          name: c.name,
          comment: '',
          columns: [],
          indexes: [],
          foreignKeys: [],
          checks: [],
          triggers: []
        })),
        views: [],
        functions: [],
        procedures: [],
        indexes: [],
        triggers: []
      })
    } else {
      items.push({
        name: dbInfo.name,
        charset: 'utf8',
        collation: '',
        tables: [],
        views: [],
        functions: [],
        procedures: [],
        indexes: [],
        triggers: []
      })
    }
  }
  return items
}

export const executeMongoQuery = async (connection: AdapterConnection, databaseName: string, sqlText: string): Promise<QueryExecutionResult> => {
  const client = await getMongoClient(connection)
  const dbName = databaseName || 'admin'
  const startTime = new Date().toISOString()
  const startMs = performance.now()

  try {
    // 尝试解析为 MongoDB JSON 查询
    const parsed = parseMongoQuery(sqlText)
    if (parsed) {
      const collectionName = (parsed.options?.collection as string) || parsed.filter._collection as string
      if (!collectionName) {
        return { success: false, message: '查询需包含 collection 字段，格式: {"collection":"xxx","filter":{...}}', startTime, endTime: new Date().toISOString(), durationMs: Math.round(performance.now() - startMs), queryCount: 1, successCount: 0, errorCount: 1 }
      }
      const db = client.db(dbName)
      const collection = db.collection(collectionName)
      const filter = parsed.filter || {}
      // 移除 _collection 字段
      delete filter._collection
      const limit = (parsed.options?.limit as number) || QUERY_ROW_LIMIT
      const skip = (parsed.options?.skip as number) || 0
      const sort = (parsed.options?.sort as Sort) || undefined

      const docs = await collection.find(filter).sort(sort || {}).skip(skip).limit(limit).toArray()
      const rows = docs.map(serializeDoc)
      const allKeys = new Set<string>()
      for (const row of rows) {
        for (const key of Object.keys(row)) allKeys.add(key)
      }
      const columns = Array.from(allKeys)
      const endTime = new Date().toISOString()
      const durationMs = Math.round(performance.now() - startMs)
      const truncated = rows.length >= limit

      let cursorId: string | undefined
      if (truncated) {
        const cursor = createCursor({
          connectionId: connection.id,
          engine: 'MongoDB',
          connectionKey: `${connection.host}:${connection.port}/${dbName}`,
          databaseName: dbName,
          sql: JSON.stringify(parsed),
          columns,
          offset: rows.length,
          totalRows: rows.length
        })
        cursorId = cursor.id
      }

      return {
        success: true,
        message: `查询成功，返回 ${rows.length} 条文档`,
        columns,
        rows,
        startTime,
        endTime,
        durationMs,
        queryCount: 1,
        successCount: 1,
        errorCount: 0,
        truncated,
        cursorId
      }
    }

    // 尝试作为 MongoDB shell 风格的命令
    const db = client.db(dbName)
    const collMatch = sqlText.match(/^db\.(\w+)\.(find|countDocuments|aggregate|insertOne|deleteOne|updateOne|findOne)\((.*)\)$/s)
    if (collMatch) {
      const [, collName, method, argsStr] = collMatch
      const collection = db.collection(collName)
      let args: unknown[] = []
      try { args = argsStr.trim() ? JSON.parse(`[${argsStr}]`) : [] } catch { /* ignore */ }

      let result: unknown
      if (method === 'find') {
        const filter = (args[0] as Record<string, unknown>) || {}
        const projection = (args[1] as Record<string, unknown>) || undefined
        const docs = await collection.find(filter).project(projection).limit(QUERY_ROW_LIMIT).toArray()
        const rows = docs.map(serializeDoc)
        const allKeys = new Set<string>()
        for (const row of rows) for (const key of Object.keys(row)) allKeys.add(key)
        const columns = Array.from(allKeys)
        const endTime = new Date().toISOString()
        return {
          success: true, message: `查询成功，返回 ${rows.length} 条文档`, columns, rows,
          startTime, endTime, durationMs: Math.round(performance.now() - startMs),
          queryCount: 1, successCount: 1, errorCount: 0
        }
      } else if (method === 'countDocuments') {
        const filter = (args[0] as Record<string, unknown>) || {}
        result = await collection.countDocuments(filter)
      } else if (method === 'aggregate') {
        const pipeline = (args[0] as Document[]) || []
        const docs = await collection.aggregate(pipeline).limit(QUERY_ROW_LIMIT).toArray()
        const rows = docs.map(serializeDoc)
        const allKeys = new Set<string>()
        for (const row of rows) for (const key of Object.keys(row)) allKeys.add(key)
        const columns = Array.from(allKeys)
        const endTime = new Date().toISOString()
        return {
          success: true, message: `聚合成功，返回 ${rows.length} 条文档`, columns, rows,
          startTime, endTime, durationMs: Math.round(performance.now() - startMs),
          queryCount: 1, successCount: 1, errorCount: 0
        }
      } else if (method === 'insertOne') {
        const doc = (args[0] as Document) || {}
        const r = await collection.insertOne(doc)
        result = { insertedId: r.insertedId?.toString() }
      } else if (method === 'deleteOne') {
        const filter = (args[0] as Record<string, unknown>) || {}
        const r = await collection.deleteOne(filter)
        result = { deletedCount: r.deletedCount }
      } else if (method === 'updateOne') {
        const filter = (args[0] as Record<string, unknown>) || {}
        const update = (args[1] as Document) || {}
        const r = await collection.updateOne(filter, update)
        result = { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount }
      } else if (method === 'findOne') {
        const filter = (args[0] as Record<string, unknown>) || {}
        const doc = await collection.findOne(filter)
        const rows = doc ? [serializeDoc(doc)] : []
        const allKeys = new Set<string>()
        for (const row of rows) for (const key of Object.keys(row)) allKeys.add(key)
        const columns = Array.from(allKeys)
        const endTime = new Date().toISOString()
        return {
          success: true, message: `查询成功，返回 ${rows.length} 条文档`, columns, rows,
          startTime, endTime, durationMs: Math.round(performance.now() - startMs),
          queryCount: 1, successCount: 1, errorCount: 0
        }
      }

      const endTime = new Date().toISOString()
      return {
        success: true, message: '执行成功',
        columns: ['result'], rows: [{ result: JSON.stringify(result) }],
        startTime, endTime, durationMs: Math.round(performance.now() - startMs),
        queryCount: 1, successCount: 1, errorCount: 0
      }
    }

    return { success: false, message: '无法解析查询。支持格式：JSON 查询对象 或 db.collection.find({...}) 等 shell 命令', startTime, endTime: new Date().toISOString(), durationMs: Math.round(performance.now() - startMs), queryCount: 1, successCount: 0, errorCount: 1 }
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return { success: false, message: error instanceof Error ? error.message : '查询执行失败', startTime, endTime, durationMs, queryCount: 1, successCount: 0, errorCount: 1 }
  }
}

export const fetchMoreMongoRows = async (
  connection: AdapterConnection,
  databaseName: string,
  cursor: QueryCursor,
  count: number = QUERY_ROW_LIMIT
): Promise<{ rows: Array<Record<string, unknown>>; done: boolean }> => {
  const client = await getMongoClient(connection)
  const db = client.db(databaseName)
  const parsed = parseMongoQuery(cursor.sql)
  if (!parsed) return { rows: [], done: true }

  const collectionName = (parsed.options?.collection as string) || (parsed.filter as Record<string, unknown>)._collection as string
  if (!collectionName) return { rows: [], done: true }

  const collection = db.collection(collectionName)
  const filter = { ...parsed.filter }
  delete filter._collection
  const skip = cursor.offset
  const limit = count
  const sort = (parsed.options?.sort as Sort) || undefined

  const docs = await collection.find(filter).sort(sort || {}).skip(skip).limit(limit).toArray()
  const rows = docs.map(serializeDoc)
  const done = rows.length < count
  updateCursorOffset(cursor.id, cursor.offset + rows.length)
  if (done) deleteCursor(cursor.id)
  return { rows, done }
}

export const readMongoTableData = async (
  connection: AdapterConnection,
  databaseName: string,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  const client = await getMongoClient(connection)
  const db = client.db(databaseName)
  const collection = db.collection(tableName)
  const startTime = new Date().toISOString()
  const startMs = performance.now()

  try {
    const query = filter?.filters?.length ? buildFilter(filter) : {}
    const docs = await collection.find(query).skip(offset).limit(limit).toArray()
    const rows = docs.map(serializeDoc)
    const allKeys = new Set<string>()
    for (const row of rows) for (const key of Object.keys(row)) allKeys.add(key)
    const columns = Array.from(allKeys)
    const endTime = new Date().toISOString()

    return {
      success: true,
      message: `已加载 ${rows.length} 条文档`,
      columns,
      rows,
      startTime,
      endTime,
      durationMs: Math.round(performance.now() - startMs),
      queryCount: 1,
      successCount: 1,
      errorCount: 0
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '读取数据失败', startTime, endTime: new Date().toISOString(), durationMs: Math.round(performance.now() - startMs), queryCount: 1, successCount: 0, errorCount: 1 }
  }
}

export const updateMongoRow = async (connection: AdapterConnection, databaseName: string, input: QueryUpdateRowInput): Promise<ConnectionActionResult> => {
  const client = await getMongoClient(connection)
  const db = client.db(databaseName)
  const collection = db.collection(input.tableName)

  try {
    const pk = input.primaryKeyValues
    const filter: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(pk)) {
      if (key === '_id') {
        try { filter._id = new ObjectId(val as string) } catch { filter._id = val }
      } else {
        filter[key] = val
      }
    }

    const updateDoc: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(input.changes)) {
      updateDoc[key] = val
    }

    const result = await collection.updateOne(filter, { $set: updateDoc })
    if (result.matchedCount === 0) return { success: false, message: '未找到该文档，可能已被修改或删除' }
    return { success: true, message: '文档已更新' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '更新失败' }
  }
}

export const deleteMongoRow = async (connection: AdapterConnection, databaseName: string, input: QueryDeleteRowInput): Promise<ConnectionActionResult> => {
  const client = await getMongoClient(connection)
  const db = client.db(databaseName)
  const collection = db.collection(input.tableName)

  try {
    const pk = input.primaryKeyValues
    const filter: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(pk)) {
      if (key === '_id') {
        try { filter._id = new ObjectId(val as string) } catch { filter._id = val }
      } else {
        filter[key] = val
      }
    }

    const result = await collection.deleteOne(filter)
    if (result.deletedCount === 0) return { success: false, message: '未找到该文档，可能已被修改或删除' }
    return { success: true, message: '文档已删除' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '删除失败' }
  }
}

export const getMongoTableDefinition = async (connection: AdapterConnection, databaseName: string, tableName: string): Promise<TableDefinitionResult> => {
  const client = await getMongoClient(connection)
  const db = client.db(databaseName)
  const collection = db.collection(tableName)

  try {
    // 采样文档推断 schema
    const sample = await collection.aggregate([{ $sample: { size: 100 } }]).toArray()
    if (!sample.length) {
      return {
        success: true,
        message: '集合为空，无字段可推断',
        tableName,
        tableComment: '',
        columns: [],
        indexes: [],
        foreignKeys: []
      }
    }

    // 统计字段出现频率和类型
    const fieldStats = new Map<string, { type: MySQLColumnType; count: number }>()
    for (const doc of sample) {
      for (const [key, val] of Object.entries(doc)) {
        const existing = fieldStats.get(key)
        const type = mongoTypeToColumnType(val)
        if (existing) {
          existing.count++
          if (existing.type !== type) existing.type = 'TEXT' // 类型不一致则降级
        } else {
          fieldStats.set(key, { type, count: 1 })
        }
      }
    }

    const totalDocs = sample.length
    const columns: TableDefinitionResult['columns'] = []
    for (const [name, stat] of fieldStats) {
      columns.push({
        name,
        originalName: name,
        type: stat.type,
        typeDefinition: stat.type,
        length: '',
        decimals: '',
        notNull: stat.count === totalDocs,
        primaryKey: name === '_id',
        comment: stat.count < totalDocs ? `出现在 ${stat.count}/${totalDocs} 文档中` : '',
        defaultValue: name === '_id' ? 'ObjectId()' : undefined
      })
    }

    // 读取索引
    const indexes = await collection.listIndexes().toArray()
    const indexDefs: TableDefinitionResult['indexes'] = indexes
      .filter((idx) => idx.name !== '_id_')
      .map((idx) => ({
        name: idx.name,
        type: (idx.unique ? 'UNIQUE' : 'INDEX') as 'UNIQUE' | 'INDEX',
        columns: Object.keys(idx.key)
      }))

    return {
      success: true,
      message: `集合结构推断完成（采样 ${totalDocs} 条文档）`,
      tableName,
      tableComment: '',
      columns,
      indexes: indexDefs,
      foreignKeys: []
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '读取集合结构失败' }
  }
}
