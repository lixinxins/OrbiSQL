/**
 * SQLite Worker 线程 (P1-2)
 * 将所有 node:sqlite 同步操作迁移到独立线程，避免阻塞主进程事件循环。
 * 主线程通过消息传递发送请求，Worker 执行同步操作后返回结果。
 */
import { parentPort } from 'node:worker_threads'
import { createRequire } from 'node:module'

// ── 加载 SQLite 模块（与 sqlite-runtime.ts 相同方式） ──────────────────
const originalEmitWarning = process.emitWarning
process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning?.message
  if (message?.includes('SQLite is an experimental feature')) return
  return (originalEmitWarning as Function).call(process, warning, ...args)
}
const sqliteModuleId = ['node', 'sqlite'].join(':')
const { DatabaseSync } = createRequire(import.meta.url)(sqliteModuleId) as {
  DatabaseSync: new (path: string) => {
    close: () => void
    exec: (sql: string) => void
    prepare: (sql: string) => {
      all: (...values: unknown[]) => unknown[]
      columns: () => Array<{ name: string; column?: string; database?: string; table?: string; type?: string | null }>
      get: (...values: unknown[]) => unknown
      run: (...values: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint }
    }
  }
}

// ── 数据库句柄管理 ─────────────────────────────────────────────────────
const handles = new Map<string, InstanceType<typeof DatabaseSync>>()

// ── 消息处理 ────────────────────────────────────────────────────────────
if (parentPort) {
  parentPort.on('message', async (msg: {
    id: number
    type: string
    payload: Record<string, unknown>
  }) => {
    try {
      const result = await handleMessage(msg.type, msg.payload)
      parentPort!.postMessage({ id: msg.id, ok: true, result })
    } catch (error) {
      parentPort!.postMessage({ id: msg.id, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}

async function handleMessage(type: string, payload: Record<string, unknown>): Promise<unknown> {
  switch (type) {
    case 'open': {
      const { filePath, handleId } = payload as { filePath: string; handleId: string }
      if (!handles.has(handleId)) {
        const db = new DatabaseSync(filePath)
        db.exec('PRAGMA foreign_keys = ON')
        handles.set(handleId, db)
      }
      return undefined
    }

    case 'close': {
      const { handleId } = payload as { handleId: string }
      const handle = handles.get(handleId)
      if (handle) {
        handles.delete(handleId)
        handle.close()
      }
      return undefined
    }

    case 'exec': {
      const { handleId, sql } = payload as { handleId: string; sql: string }
      getHandle(handleId).exec(sql)
      return undefined
    }

    case 'query': {
      const { handleId, sql, params } = payload as { handleId: string; sql: string; params: unknown[] }
      const db = getHandle(handleId)
      const statement = db.prepare(sql)
      const columns = statement.columns().map((c) => c.name)
      if (columns.length) {
        const rows = statement.all(...(params ?? [])) as Array<Record<string, unknown>>
        return { columns, rows }
      }
      const runResult = statement.run(...(params ?? []))
      return { changes: Number(runResult.changes) }
    }

    case 'get': {
      const { handleId, sql, params } = payload as { handleId: string; sql: string; params: unknown[] }
      const db = getHandle(handleId)
      return db.prepare(sql).get(...(params ?? []))
    }

    case 'all': {
      const { handleId, sql, params } = payload as { handleId: string; sql: string; params: unknown[] }
      const db = getHandle(handleId)
      return db.prepare(sql).all(...(params ?? []))
    }

    case 'export': {
      const { handleId, tableNames, includeData, filePath: exportPath } =
        payload as { handleId: string; tableNames: string[]; includeData: boolean; filePath: string }
      return exportSqliteToWorker(getHandle(handleId), handleId, tableNames, includeData, exportPath)
    }

    default:
      throw new Error(`未知的 Worker 操作类型: ${type}`)
  }
}

function getHandle(handleId: string): InstanceType<typeof DatabaseSync> {
  const handle = handles.get(handleId)
  if (!handle) throw new Error(`SQLite 句柄 "${handleId}" 未打开`)
  return handle
}

// ── Worker 内导出：边生成边写文件，避免大字符串回传主线程 ─────────────────
async function exportSqliteToWorker(
  database: InstanceType<typeof DatabaseSync>,
  handleId: string,
  tableNames: string[],
  includeData: boolean,
  filePath: string
): Promise<{ filePath: string; totalLength: number }> {
  const { basename } = await import('node:path')
  const { writeFileSync, appendFileSync, statSync } = await import('node:fs')

  const quoteId = (value: string): string => `"${value.replaceAll('"', '""')}"`
  const dumpValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number' || typeof value === 'bigint') return String(value)
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
    return `'${String(value).replaceAll("'", "''")}'`
  }

  const header = [
    `-- QuillDB SQLite export: ${basename(handleId)}`,
    `-- Generated at ${new Date().toISOString()}`,
    '',
    'PRAGMA foreign_keys=OFF;',
    'BEGIN TRANSACTION;'
  ].join('\n')
  writeFileSync(filePath, header, 'utf8')

  const total = tableNames.length
  for (let index = 0; index < total; index++) {
    const tableName = tableNames[index]
    // 发送进度回调
    parentPort?.postMessage({
      id: -1,
      type: 'progress',
      payload: { current: index + 1, total, tableName, message: `正在导出表 ${tableName} (${index + 1}/${total})...` }
    })

    const table = quoteId(tableName)
    const schema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { sql?: string } | undefined
    if (!schema?.sql) continue

    const tableStatements: string[] = ['', `DROP TABLE IF EXISTS ${table};`, `${schema.sql};`]
    const objects = database.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name").all(tableName) as unknown as Array<{ sql: string }>
    tableStatements.push(...objects.map((o) => `${o.sql};`))

    if (includeData) {
      const pkInfo = database.prepare(`PRAGMA table_info(${quoteId(tableName)})`).all() as unknown as Array<{ name: string; pk: number }>
      const pkCols = pkInfo.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk)
      const orderBy = pkCols.length
        ? `ORDER BY ${pkCols.map((c) => quoteId(c.name)).join(', ')}`
        : 'ORDER BY rowid'
      const BATCH_SIZE = 5000
      let offset = 0
      let names: string[] = []
      while (true) {
        const rows = database.prepare(`SELECT * FROM ${table} ${orderBy} LIMIT ${BATCH_SIZE} OFFSET ${offset}`).all() as Array<Record<string, unknown>>
        if (!rows.length) break
        if (!names.length) names = Object.keys(rows[0])
        for (const row of rows) {
          tableStatements.push(`INSERT INTO ${table} (${names.map(quoteId).join(', ')}) VALUES (${names.map((name) => dumpValue(row[name])).join(', ')});`)
        }
        offset += BATCH_SIZE
      }
    }
    appendFileSync(filePath, '\n' + tableStatements.join('\n'), 'utf8')
  }

  const footer = '\nCOMMIT;\nPRAGMA foreign_keys=ON;\n'
  appendFileSync(filePath, footer, 'utf8')

  const fileSize = statSync(filePath).size
  return { filePath, totalLength: fileSize }
}
