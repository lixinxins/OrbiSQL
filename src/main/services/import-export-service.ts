import { dialog } from 'electron'
import { createReadStream, createWriteStream } from 'node:fs'
import { stat as fsStat, readFile, writeFile } from 'node:fs/promises'
import { Parser } from 'csv-parse'
import { stringify } from 'csv-stringify/sync'
import * as XLSX from 'xlsx'
import type { RowDataPacket } from 'mysql2/promise'
import type {
  ConnectionActionResult,
  ExecuteImportInput,
  ExportSqlProgress,
  ExportSqlResult,
  ExportTableCustomInput,
  PreviewExportSqlResult,
  PreviewImportResult,
  TransferTableDataInput
} from '../../shared/connections'
import type { StoredConnection } from '../database/connection-repository'
import type { ConnectionService } from './connection-service'
import { getMysqlPool, exportMysqlTables, quoteMysqlIdentifier } from './adapters/mysql-adapter'
import { exportPostgreSqlTables, getPostgresPool } from './adapters/postgresql-adapter'
import { exportSqliteTables, ensureSqliteHandle } from './adapters/sqlite-adapter'
import { getDmPool } from './adapters/dm-adapter'
import { getKbPool } from './adapters/kingbase-adapter'
import { sqliteWorkerQuery } from './sqlite-runtime'
import type { Pool } from 'pg'

// ── Standalone helpers ────────────────────────────────────────────────

const isMysqlFamily = (engine: string): boolean =>
  engine === 'MySQL' || engine === 'MariaDB' || engine === 'TiDB'

const isPgFamily = (engine: string): boolean =>
  engine === 'PostgreSQL' || engine === '达梦' || engine === '人大金仓'

const quoteIdentifierForEngine = (engine: StoredConnection['engine'], identifier: string): string =>
  engine === 'PostgreSQL'
    ? `"${identifier.replaceAll('"', '""')}"`
    : quoteMysqlIdentifier(identifier)

/** 加固字符串字面量转义：先转义反斜杠再转义单引号，降低 SQL 注入面 */
const quotePortableString = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`

/** 各引擎参数占位符上限（保守值），用于动态计算批量大小，避免 too many SQL variables */
const maxParamsForEngine = (engine: string): number => {
  if (engine === 'SQLite') return 900
  if (isPgFamily(engine) || engine === 'SQL Server') return 2000
  if (isMysqlFamily(engine)) return 6000
  return 500
}

/** 根据列数动态计算批量大小，确保占位符总数不超过引擎上限，并 cap 到 500 */
const computeBatchSize = (engine: string, columnCount: number): number =>
  Math.max(1, Math.min(500, Math.floor(maxParamsForEngine(engine) / Math.max(1, columnCount))))

const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return '数据库连接失败'
  if ('code' in error) {
    const code = String(error.code)
    if (code === 'ECONNREFUSED') return '无法连接数据库，请确认数据库服务已启动且主机、端口正确'
    if (code === 'ER_ACCESS_DENIED_ERROR') return '用户名或密码错误'
    if (code === '28P01') return 'PostgreSQL 用户名或密码错误'
    if (code === '3D000') return 'PostgreSQL 默认数据库不存在'
    if (code === 'SQLITE_CANTOPEN') return '无法打开 SQLite 数据库文件，请检查路径和文件权限'
    if (code === 'ENOTFOUND') return '找不到数据库主机'
  }
  return error.message || '数据库连接失败'
}

// ── ImportExportService ───────────────────────────────────────────────

export class ImportExportService {
  constructor(
    private readonly connectionService: ConnectionService
  ) {}

  /**
   * 参数化批量插入：优先使用预编译占位符，消除 SQL 注入面。
   * - MySQL 族 / SQLite / PG 族（非 SSH）：直接走驱动参数化查询
   * - PG 族（SSH）与其余引擎：回退到加固转义拼接（经 executeQuery 以应用 SSH 隧道）
   * 批量大小按列数与引擎占位符上限动态计算，避免 too many SQL variables。
   */
  private async executeParamBatchInsert(
    connection: StoredConnection,
    databaseName: string,
    tableName: string,
    columns: string[],
    rows: Array<Record<string, unknown>>
  ): Promise<void> {
    if (rows.length === 0 || columns.length === 0) return
    const batchSize = computeBatchSize(connection.engine, columns.length)

    // PG 族在 SSH 隧道下无法直接走池参数化（池不会走隧道），回退拼接经 executeQuery
    const needsFallback = !isMysqlFamily(connection.engine)
      && connection.engine !== 'SQLite'
      && !(isPgFamily(connection.engine) && !connection.sshEnabled)

    if (needsFallback) {
      const escapedColumns = columns.map((h) => quoteIdentifierForEngine(connection.engine, h)).join(', ')
      const quotedTable = quoteIdentifierForEngine(connection.engine, tableName)
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        const values = batch
          .map((r) => `(${columns.map((h) => r[h] == null ? 'NULL' : quotePortableString(String(r[h]))).join(', ')})`)
          .join(', ')
        const res = await this.connectionService.executeQuery(connection.id, databaseName,
          `INSERT INTO ${quotedTable} (${escapedColumns}) VALUES ${values}`)
        if (!res.success) throw new Error(res.message)
      }
      return
    }

    if (isMysqlFamily(connection.engine)) {
      const pool = getMysqlPool(connection, databaseName)
      const escapedCols = columns.map((h) => quoteMysqlIdentifier(h)).join(', ')
      const quotedTable = quoteMysqlIdentifier(tableName)
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
        const values = batch.flatMap((r) => columns.map((h) => r[h]))
        await pool.query(`INSERT INTO ${quotedTable} (${escapedCols}) VALUES ${placeholders}`, values)
      }
      return
    }

    if (connection.engine === 'SQLite') {
      const handleId = await ensureSqliteHandle(connection)
      const escapedCols = columns.map((h) => quoteIdentifierForEngine('SQLite', h)).join(', ')
      const quotedTable = quoteIdentifierForEngine('SQLite', tableName)
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
        const values = batch.flatMap((r) => columns.map((h) => r[h]))
        await sqliteWorkerQuery(handleId, `INSERT INTO ${quotedTable} (${escapedCols}) VALUES ${placeholders}`, values)
      }
      return
    }

    // PG 族（非 SSH）：使用 $N 占位符参数化
    let pool: Pool
    if (connection.engine === 'PostgreSQL') pool = getPostgresPool(connection, databaseName)
    else if (connection.engine === '达梦') pool = await getDmPool(connection)
    else pool = await getKbPool(connection)
    const escapedCols = columns.map((h) => quoteIdentifierForEngine('PostgreSQL', h)).join(', ')
    const quotedTable = quoteIdentifierForEngine('PostgreSQL', tableName)
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      let idx = 1
      const placeholders = batch
        .map(() => `(${columns.map(() => '$' + String(idx++)).join(', ')})`)
        .join(', ')
      const values = batch.flatMap((r) => columns.map((h) => r[h]))
      await pool.query(`INSERT INTO ${quotedTable} (${escapedCols}) VALUES ${placeholders}`, values)
    }
  }

  /**
   * 流式 JSON 导入：逐字符扫描提取顶层数组元素，按批插入，
   * 避免大 JSON 文件一次性 JSON.parse 导致 OOM。
   */
  private async importJsonStreaming(
    connection: StoredConnection,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<{ totalInserted: number }> {
    const content = await readFile(filePath, 'utf8')
    const arrayStart = content.indexOf('[')
    if (arrayStart === -1) return { totalInserted: 0 }

    const BATCH_SIZE = 500
    let batch: Array<Record<string, unknown>> = []
    let totalInserted = 0
    let headers: string[] | null = null
    let depth = 0
    let inString = false
    let escaped = false
    let objStart = -1

    for (let i = arrayStart + 1; i < content.length; i++) {
      const c = content[i]
      if (escaped) { escaped = false; continue }
      if (c === '\\' && inString) { escaped = true; continue }
      if (c === '"') { inString = !inString; continue }
      if (inString) continue

      if (c === '{') {
        if (depth === 0) objStart = i
        depth++
      } else if (c === '}') {
        depth--
        if (depth === 0 && objStart >= 0) {
          const obj = JSON.parse(content.slice(objStart, i + 1)) as Record<string, unknown>
          if (headers === null) headers = Object.keys(obj)
          batch.push(obj)
          if (batch.length >= BATCH_SIZE) {
            await this.executeParamBatchInsert(connection, databaseName, tableName, headers, batch)
            totalInserted += batch.length
            batch = []
          }
          objStart = -1
        }
      }
    }

    if (batch.length > 0 && headers) {
      await this.executeParamBatchInsert(connection, databaseName, tableName, headers, batch)
      totalInserted += batch.length
    }
    return { totalInserted }
  }

  async importTableData(
    connectionId: number,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<ConnectionActionResult> {
    const connection = this.connectionService.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    try {
      const extension = filePath.split('.').pop()?.toLowerCase()
      const isCsv = extension === 'csv' || extension === 'tsv'

      // ── CSV/TSV 流式导入：逐批读取 + 逐批写入，防止大文件 OOM ──
      if (isCsv) {
        let totalInserted = 0
        await new Promise<void>((resolve, reject) => {
          let headers: string[] | null = null
          let batch: Array<Record<string, unknown>> = []
          const BATCH_SIZE = 500
          let settled = false
          const fail = (err: unknown): void => { if (!settled) { settled = true; reject(err) } }

          const parser = new Parser({
            bom: true, columns: false, skip_empty_lines: true,
            relax_column_count: true, trim: false,
            delimiter: extension === 'tsv' ? '\t' : ','
          })

          const insertBatch = async (rows: Array<Record<string, unknown>>, cols: string[]): Promise<void> => {
            await this.executeParamBatchInsert(connection, databaseName, tableName, cols, rows)
          }

          const validateHeaders = async (hdrs: string[]): Promise<void> => {
            if (connection.engine !== 'MySQL') {
              const databases = await this.connectionService.readDatabases(connection)
              const table = databases.flatMap((db) => db.tables).find((t) => t.name === tableName)
              if (!table) throw new Error('数据表不存在或已被删除')
              const unknown = hdrs.filter((h) => !table.columns.some((c) => c.name === h))
              if (unknown.length) throw new Error(`导入字段不存在：${unknown.join('、')}`)
            } else {
              const pool = getMysqlPool(connection, databaseName)
              const [columnRows] = await pool.query<Array<RowDataPacket & { columnName: string }>>(
                `SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
                [databaseName, tableName])
              const available = new Set(columnRows.map((r) => r.columnName))
              const unknown = hdrs.filter((h) => !available.has(h))
              if (unknown.length) throw new Error(`导入字段不存在：${unknown.join('、')}`)
            }
          }

          parser.on('data', (rawRow: string[]) => {
            if (headers === null) {
              headers = rawRow
              void validateHeaders(headers).catch(fail)
              return
            }
            const record: Record<string, unknown> = {}
            headers.forEach((h, i) => { record[h] = i < rawRow.length ? rawRow[i] : null })
            batch.push(record)
            if (batch.length >= BATCH_SIZE) {
              const rowsToInsert = batch
              batch = []
              void insertBatch(rowsToInsert, headers).then((() => { totalInserted += rowsToInsert.length })).catch(fail)
            }
          })
          parser.on('end', () => {
            if (headers && batch.length > 0) {
              void insertBatch(batch, headers).then(() => {
                totalInserted += batch.length
                if (!settled) { settled = true; resolve() }
              }).catch(fail)
            } else if (!settled) {
              settled = true
              resolve()
            }
          })
          parser.on('error', fail)
          createReadStream(filePath, 'utf8').pipe(parser)
        })

        if (totalInserted === 0) return { success: false, message: '文件没有可导入的数据，请确认首个工作表或 JSON 数组包含记录' }
        return { success: true, message: `导入成功，共写入 ${totalInserted} 行` }
      }

      // ── JSON / Excel：全量内存解析（文件通常较小） ──
      let rows: Array<Record<string, unknown>>
      if (extension === 'json') {
        const { totalInserted } = await this.importJsonStreaming(connection, databaseName, tableName, filePath)
        if (totalInserted === 0) return { success: false, message: '文件没有可导入的数据，请确认 JSON 数组包含记录' }
        return { success: true, message: `导入成功，共写入 ${totalInserted} 行` }
      } else if (extension === 'xlsx' || extension === 'xls') {
        const workbook = XLSX.read(await readFile(filePath), { type: 'buffer', cellDates: true })
        const sheetName = workbook.SheetNames[0]
        rows = sheetName ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null }) : []
      } else {
        return { success: false, message: '不支持的文件格式，请使用 CSV、TSV、JSON 或 XLSX 文件' }
      }

      if (!rows.length) return { success: false, message: '文件没有可导入的数据，请确认首个工作表或 JSON 数组包含记录' }
      const headers = Object.keys(rows[0])
      if (!headers.length) return { success: false, message: '文件缺少字段名称' }

      if (connection.engine !== 'MySQL') {
        const databases = await this.connectionService.readDatabases(connection)
        const table = databases.flatMap((database) => database.tables).find((item) => item.name === tableName)
        if (!table) return { success: false, message: '数据表不存在或已被删除' }
        const unknownHeaders = headers.filter((header) => !table.columns.some((c) => c.name === header))
        if (unknownHeaders.length) return { success: false, message: `导入字段不存在：${unknownHeaders.join('、')}` }
        await this.executeParamBatchInsert(connection, databaseName, tableName, headers, rows)
        return { success: true, message: `导入成功，共写入 ${rows.length} 行` }
      }

      const pool = getMysqlPool(connection, databaseName)
      const [columnRows] = await pool.query<Array<RowDataPacket & { columnName: string }>>(
        `SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [databaseName, tableName]
      )
      const availableColumns = new Set(columnRows.map((row) => row.columnName))
      const unknownHeaders = headers.filter((header) => !availableColumns.has(header))
      if (unknownHeaders.length) return { success: false, message: `导入字段不存在：${unknownHeaders.join('、')}` }

      await this.executeParamBatchInsert(connection, databaseName, tableName, headers, rows)
      return { success: true, message: `导入成功，共写入 ${rows.length} 行` }
    } catch (error) {
      return { success: false, message: errorMessage(error) }
    }
  }

  async previewImportFile(
    connectionId: number,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<PreviewImportResult> {
    const connection = this.connectionService.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    try {
      const stats = await fsStat(filePath)
      const fileName = filePath.split(/[/\\]/).pop() || 'data-file'
      const fileSize = stats.size
      const extension = fileName.split('.').pop()?.toLowerCase() || ''

      let rows: Array<Record<string, unknown>> = []

      if (extension === 'csv' || extension === 'tsv') {
        const fileContent = await readFile(filePath, 'utf8')
        const parser = new Parser({
          bom: true,
          columns: true,
          skip_empty_lines: true,
          relax_column_count: true,
          trim: true,
          delimiter: extension === 'tsv' ? '\t' : ','
        })
        const records: Array<Record<string, unknown>> = []
        await new Promise<void>((resolve, reject) => {
          parser.on('data', (record: Record<string, unknown>) => {
            records.push(record)
          })
          parser.on('end', () => resolve())
          parser.on('error', (err) => reject(err))
          parser.write(fileContent)
          parser.end()
        })
        rows = records
      } else if (extension === 'json') {
        const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
        const list = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
            ? (parsed as { data: unknown[] }).data
            : []
        rows = list.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        )
      } else if (extension === 'xlsx' || extension === 'xls') {
        const workbook = XLSX.read(await readFile(filePath), { type: 'buffer', cellDates: true })
        const sheetName = workbook.SheetNames[0]
        rows = sheetName
          ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null })
          : []
      } else {
        return { success: false, message: '不支持的文件格式，请使用 CSV、TSV、JSON 或 Excel 文件' }
      }

      if (!rows.length) {
        return { success: false, message: '文件内没有数据或解析结果为空' }
      }

      const fileHeaders = Object.keys(rows[0])
      if (!fileHeaders.length) {
        return { success: false, message: '无法识别文件数据列标题' }
      }

      const definition = await this.connectionService.getTableDefinition(connectionId, databaseName, tableName)
      const tableColumns = (definition.columns ?? []).map((c) => ({
        name: c.name,
        type: c.typeDefinition ?? c.type,
        comment: c.comment
      }))

      // Auto match file header to table column name
      const initialMapping: Record<string, string> = {}
      fileHeaders.forEach((header) => {
        const lowerHeader = header.toLowerCase().replace(/[^a-z0-9]/g, '')
        const matchedCol = tableColumns.find(
          (col) => col.name.toLowerCase().replace(/[^a-z0-9]/g, '') === lowerHeader
        )
        initialMapping[header] = matchedCol ? matchedCol.name : ''
      })

      return {
        success: true,
        connectionId,
        databaseName,
        tableName,
        filePath,
        fileName,
        fileSize,
        totalRows: rows.length,
        fileHeaders,
        previewRows: rows.slice(0, 200),
        tableColumns,
        initialMapping
      }
    } catch (error) {
      return { success: false, message: errorMessage(error) }
    }
  }

  async executeImportWithMapping(input: ExecuteImportInput): Promise<ConnectionActionResult> {
    const { connectionId, databaseName, tableName, filePath, columnMapping, clearTarget } = input
    const connection = this.connectionService.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    // Keep active mappings
    const activeHeaders = Object.keys(columnMapping).filter((h) => Boolean(columnMapping[h]))
    if (activeHeaders.length === 0) {
      return { success: false, message: '请至少为一个数据源列选择映射目标字段' }
    }

    try {
      if (clearTarget) {
        await this.connectionService.truncateTable(connectionId, databaseName, tableName)
      }

      const extension = filePath.split('.').pop()?.toLowerCase() || ''
      let rows: Array<Record<string, unknown>> = []

      if (extension === 'csv' || extension === 'tsv') {
        const fileContent = await readFile(filePath, 'utf8')
        const parser = new Parser({
          bom: true,
          columns: true,
          skip_empty_lines: true,
          relax_column_count: true,
          trim: true,
          delimiter: extension === 'tsv' ? '\t' : ','
        })
        const records: Array<Record<string, unknown>> = []
        await new Promise<void>((resolve, reject) => {
          parser.on('data', (record: Record<string, unknown>) => records.push(record))
          parser.on('end', () => resolve())
          parser.on('error', (err) => reject(err))
          parser.write(fileContent)
          parser.end()
        })
        rows = records
      } else if (extension === 'json') {
        // 流式 JSON 导入，避免大文件全量解析 OOM
        const content = await readFile(filePath, 'utf8')
        const arrayStart = content.indexOf('[')
        if (arrayStart === -1) return { success: false, message: '文件中未检测到 JSON 数组' }
        let depth = 0, inStr = false, escaped = false, objStart = -1
        const BATCH_SIZE = 500
        let batch: Array<Record<string, unknown>> = []
        let totalInserted = 0
        const targetCols = activeHeaders.map((h) => columnMapping[h])
        for (let i = arrayStart + 1; i < content.length; i++) {
          const c = content[i]
          if (escaped) { escaped = false; continue }
          if (c === '\\' && inStr) { escaped = true; continue }
          if (c === '"') { inStr = !inStr; continue }
          if (inStr) continue
          if (c === '{') { if (depth === 0) objStart = i; depth++ }
          else if (c === '}') {
            depth--
            if (depth === 0 && objStart >= 0) {
              const obj = JSON.parse(content.slice(objStart, i + 1)) as Record<string, unknown>
              const mapped: Record<string, unknown> = {}
              activeHeaders.forEach((h) => { mapped[columnMapping[h]] = obj[h] })
              batch.push(mapped)
              if (batch.length >= BATCH_SIZE) {
                await this.executeParamBatchInsert(connection, databaseName, tableName, targetCols, batch)
                totalInserted += batch.length
                batch = []
              }
              objStart = -1
            }
          }
        }
        if (batch.length > 0) {
          await this.executeParamBatchInsert(connection, databaseName, tableName, targetCols, batch)
          totalInserted += batch.length
        }
        if (totalInserted === 0) return { success: false, message: '文件中未检测到可导入的数据' }
        return { success: true, message: `导入成功，共写入 ${totalInserted} 行数据` }
      } else if (extension === 'xlsx' || extension === 'xls') {
        const workbook = XLSX.read(await readFile(filePath), { type: 'buffer', cellDates: true })
        const sheetName = workbook.SheetNames[0]
        rows = sheetName
          ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null })
          : []
      }

      if (!rows.length) {
        return { success: false, message: '文件中未检测到可导入的数据' }
      }

      const targetCols = activeHeaders.map((h) => columnMapping[h])

      // 将文件行（按文件表头键）重映射为目标列名键，统一走参数化批量插入
      const mappedRows: Array<Record<string, unknown>> = rows.map((row) => {
        const mapped: Record<string, unknown> = {}
        activeHeaders.forEach((h) => { mapped[columnMapping[h]] = row[h] })
        return mapped
      })
      await this.executeParamBatchInsert(connection, databaseName, tableName, targetCols, mappedRows)

      return { success: true, message: `导入成功，共写入 ${rows.length} 行数据` }
    } catch (error) {
      return { success: false, message: errorMessage(error) }
    }
  }

  async importTableCsv(connectionId: number, databaseName: string, tableName: string, filePath: string): Promise<ConnectionActionResult> {
    return this.importTableData(connectionId, databaseName, tableName, filePath)
  }

  async exportTableCsv(
    connectionId: number,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<ConnectionActionResult> {
    const connection = this.connectionService.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    const BATCH = 5000
    const safeTable = connection.engine === 'MySQL'
      ? quoteMysqlIdentifier(tableName)
      : quoteIdentifierForEngine(connection.engine, tableName)
    const writer = createWriteStream(filePath, { encoding: 'utf8' })
    let offset = 0
    let isFirst = true
    let totalRows = 0

    try {
      while (true) {
        const result = await this.connectionService.executeQuery(
          connectionId,
          databaseName,
          `SELECT * FROM ${safeTable} LIMIT ${BATCH} OFFSET ${offset}`
        )
        if (!result.success) {
          writer.end()
          return result
        }
        if (!result.rows?.length) break

        const csv = stringify(result.rows, {
          header: isFirst,
          bom: isFirst,
          columns: isFirst && result.columns ? result.columns : undefined
        })
        writer.write(csv)
        totalRows += result.rows.length
        isFirst = false
        offset += BATCH

        if (result.rows.length < BATCH) break
      }

      writer.end()
      return { success: true, message: `导出成功，共 ${totalRows} 行` }
    } catch (error) {
      writer.end()
      return { success: false, message: errorMessage(error) }
    }
  }

  async transferTableData(input: TransferTableDataInput): Promise<ConnectionActionResult> {
    const source = this.connectionService.repository.getById(input.sourceConnectionId)
    const target = this.connectionService.repository.getById(input.targetConnectionId)
    if (!source || !target) return { success: false, message: '源连接或目标连接不存在' }
    if (!source.open || !target.open) return { success: false, message: '请先打开源连接和目标连接' }
    if (input.sourceConnectionId === input.targetConnectionId && input.sourceDatabaseName === input.targetDatabaseName && input.sourceTableName === input.targetTableName) {
      return { success: false, message: '源表和目标表不能相同' }
    }
    try {
      const [sourceDefinition, targetDefinition] = await Promise.all([
        this.connectionService.getTableDefinition(input.sourceConnectionId, input.sourceDatabaseName, input.sourceTableName),
        this.connectionService.getTableDefinition(input.targetConnectionId, input.targetDatabaseName, input.targetTableName)
      ])
      if (!sourceDefinition.success || !targetDefinition.success) return { success: false, message: sourceDefinition.success ? targetDefinition.message : sourceDefinition.message }
      const targetNames = new Set((targetDefinition.columns ?? []).map((column) => column.name))
      const columns = (sourceDefinition.columns ?? []).map((column) => column.name).filter((name) => targetNames.has(name))
      if (!columns.length) return { success: false, message: '源表和目标表没有同名字段，无法自动传输' }
      if (input.clearTarget) {
        const cleared = await this.connectionService.executeQuery(input.targetConnectionId, input.targetDatabaseName, `DELETE FROM ${quoteIdentifierForEngine(target.engine, input.targetTableName)}`)
        if (!cleared.success) return { success: false, message: `清空目标表失败：${cleared.message}` }
      }
      const sqlValue = (value: unknown): string => {
        if (value === null || value === undefined) return 'NULL'
        if (typeof value === 'number' && Number.isFinite(value)) return String(value)
        if (typeof value === 'bigint') return String(value)
        if (typeof value === 'boolean') return value ? '1' : '0'
        if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`
        const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value)
        return quotePortableString(text)
      }
      const quotedColumns = columns.map((column) => quoteIdentifierForEngine(target.engine, column)).join(', ')
      let offset = 0
      let transferred = 0
      const pageSize = 500
      while (true) {
        const page = await this.connectionService.readTableData(input.sourceConnectionId, input.sourceDatabaseName, input.sourceTableName, pageSize, offset)
        if (!page.success || !page.rows) return { success: false, message: page.message }
        if (!page.rows.length) break
        for (let index = 0; index < page.rows.length; index += 100) {
          const batch = page.rows.slice(index, index + 100)
          const values = batch.map((row) => `(${columns.map((column) => sqlValue(row[column])).join(', ')})`).join(', ')
          const inserted = await this.connectionService.executeQuery(input.targetConnectionId, input.targetDatabaseName, `INSERT INTO ${quoteIdentifierForEngine(target.engine, input.targetTableName)} (${quotedColumns}) VALUES ${values}`)
          if (!inserted.success) return { success: false, message: `已传输 ${transferred} 行，写入失败：${inserted.message}` }
          transferred += batch.length
        }
        offset += page.rows.length
        if (page.rows.length < pageSize) break
      }
      return { success: true, message: `数据传输完成，共写入 ${transferred} 行，匹配 ${columns.length} 个字段` }
    } catch (error) { return { success: false, message: errorMessage(error) } }
  }

  async exportSql(
    connectionId: number,
    databaseName: string,
    filePath: string,
    includeData: boolean,
    tableName?: string,
    onProgress?: (progress: ExportSqlProgress) => void
  ): Promise<ExportSqlResult> {
    const connection = this.connectionService.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    try {
      const databases = await this.connectionService.readDatabases(connection)
      const database = databases.find((item) => item.name === databaseName)
      if (!database) return { success: false, message: '数据库不存在或无法读取' }
      const tableNames = tableName ? [tableName] : database.tables.map((table) => table.name)
      if (tableName && !database.tables.some((table) => table.name === tableName)) {
        return { success: false, message: '数据表不存在或已被删除' }
      }

      const total = tableNames.length
      onProgress?.({ current: 0, total, message: '正在准备导出...' })

      let totalLength = 0
      if (connection.engine === 'PostgreSQL') {
        const result = await exportPostgreSqlTables(connection, databaseName, tableNames, includeData, filePath, onProgress)
        totalLength = result.totalLength
      } else if (connection.engine === 'SQLite') {
        const result = await exportSqliteTables(connection, tableNames, includeData, filePath, onProgress)
        totalLength = result.totalLength
      } else {
        const result = await exportMysqlTables(connection, databaseName, tableNames, includeData, filePath, onProgress)
        totalLength = result.totalLength
      }

      onProgress?.({ current: total, total, message: '导出完成' })
      
      // P1-1: 不再回读整文件，仅用 stat 获取文件大小 + 流式读取前 500KB 作为预览
      const fileStats = await fsStat(filePath)
      const PREVIEW_BYTES = 500_000
      const isTruncated = fileStats.size > PREVIEW_BYTES
      const sqlContent = await new Promise<string>((resolve) => {
        const chunks: string[] = []
        let collected = 0
        const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 })
        stream.on('data', (chunk: string | Buffer) => {
          const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
          const remaining = PREVIEW_BYTES - collected
          if (remaining <= 0) { stream.destroy(); resolve(chunks.join('')); return }
          if (text.length <= remaining) {
            chunks.push(text)
            collected += text.length
          } else {
            chunks.push(text.slice(0, remaining))
            stream.destroy()
            resolve(chunks.join(''))
          }
        })
        stream.on('end', () => resolve(chunks.join('')))
        stream.on('error', () => resolve(''))
      })
      
      const target = tableName ? `表"${tableName}"` : `数据库"${databaseName}"`
      return {
        success: true,
        message: `${target}${includeData ? '结构和数据' : '结构'}导出成功`,
        filePath,
        sqlContent,
        totalLength,
        isTruncated
      }
    } catch (error) {
      return { success: false, message: errorMessage(error) }
    }
  }

  async previewExportSql(
    connectionId: number,
    databaseName: string,
    includeData: boolean,
    tableName?: string,
    maxRowsPerTable: number = 50
  ): Promise<PreviewExportSqlResult> {
    const connection = this.connectionService.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    try {
      const databases = await this.connectionService.readDatabases(connection)
      const database = databases.find((item) => item.name === databaseName)
      if (!database) return { success: false, message: '数据库不存在或无法读取' }

      const tables = database.tables.map((tbl) => ({
        name: tbl.name,
        columnsCount: tbl.columns?.length || 0,
        comment: tbl.comment
      }))

      const targetTables = tableName ? [tableName] : database.tables.map((t) => t.name)
      let sampleSql = `-- OmniDB SQL Export Preview\n-- Connection: ${connection.name} (${connection.engine})\n-- Database: ${databaseName}\n-- Target Tables (${targetTables.length}): ${targetTables.join(', ')}\n-- Include Data: ${includeData ? 'YES' : 'NO'}\n-- Created At: ${new Date().toLocaleString()}\n\n`

      for (const tName of targetTables) {
        const def = await this.connectionService.getTableDefinition(connectionId, databaseName, tName)
        const colsDef = def.columns || []
        if (colsDef.length) {
          const colLines = colsDef.map((c) => `  ${quoteIdentifierForEngine(connection.engine, c.name)} ${c.typeDefinition || c.type || 'TEXT'}`).join(',\n')
          sampleSql += `-- ----------------------------\n-- Table structure for ${tName}\n-- ----------------------------\nDROP TABLE IF EXISTS ${quoteIdentifierForEngine(connection.engine, tName)};\nCREATE TABLE ${quoteIdentifierForEngine(connection.engine, tName)} (\n${colLines}\n);\n\n`
        }
        if (includeData && colsDef.length) {
          const limit = Math.max(10, Math.min(maxRowsPerTable, 500))
          const sampleData = await this.connectionService.readTableData(connectionId, databaseName, tName, limit, 0)
          if (sampleData.success && sampleData.rows?.length) {
            const cols = colsDef.map((c) => quoteIdentifierForEngine(connection.engine, c.name)).join(', ')
            const rowCount = sampleData.rows.length
            const vals = sampleData.rows.map((r) => {
              const rowVals = colsDef.map((c) => {
                const v = r[c.name]
                if (v === null || v === undefined) return 'NULL'
                if (typeof v === 'number' || typeof v === 'boolean') return String(v)
                return quotePortableString(String(v))
              })
              return `(${rowVals.join(', ')})`
            }).join(',\n  ')
            sampleSql += `-- Records for ${tName} (showing ${rowCount} rows)\nINSERT INTO ${quoteIdentifierForEngine(connection.engine, tName)} (${cols}) VALUES\n  ${vals};\n\n`
          }
        }
      }

      return {
        success: true,
        connectionId,
        databaseName,
        tableName,
        includeData,
        tableCount: database.tables.length,
        tables,
        sqlPreview: sampleSql
      }
    } catch (err) {
      return { success: false, message: errorMessage(err) }
    }
  }

  async exportTableCustom(input: ExportTableCustomInput): Promise<ConnectionActionResult> {
    const { connectionId, databaseName, tableName, format, selectedColumns, includeHeader = true } = input
    let filePath = input.filePath || ''

    const connection = this.connectionService.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    if (!filePath) {
      const ext = format === 'csv' ? 'csv' : format === 'json' ? 'json' : 'xlsx'
      const filterName = format === 'csv' ? 'CSV 文件' : format === 'json' ? 'JSON 文件' : 'Excel 工作簿'
      const saveDialog = await dialog.showSaveDialog({
        title: `导出 ${tableName} 数据`,
        defaultPath: `${tableName}.${ext}`,
        filters: [{ name: filterName, extensions: [ext] }]
      })
      if (saveDialog.canceled || !saveDialog.filePath) {
        return { success: false, message: '已取消导出' }
      }
      filePath = saveDialog.filePath
    }

    try {
      const safeTable = connection.engine === 'MySQL'
        ? quoteMysqlIdentifier(tableName)
        : quoteIdentifierForEngine(connection.engine, tableName)

      const colsToSelect = selectedColumns && selectedColumns.length > 0
        ? selectedColumns.map((col) => quoteIdentifierForEngine(connection.engine, col)).join(', ')
        : '*'

      if (format === 'csv') {
        const BATCH = 5000
        const writer = createWriteStream(filePath, { encoding: 'utf8' })
        let offset = 0
        let isFirst = true
        let totalRows = 0

        try {
          while (true) {
            const result = await this.connectionService.executeQuery(
              connectionId,
              databaseName,
              `SELECT ${colsToSelect} FROM ${safeTable} LIMIT ${BATCH} OFFSET ${offset}`
            )
            if (!result.success) {
              writer.end()
              return result
            }
            if (!result.rows?.length) break

            const csvStr = stringify(result.rows, {
              header: isFirst && includeHeader,
              bom: isFirst,
              columns: selectedColumns && selectedColumns.length > 0 ? selectedColumns : undefined
            })
            writer.write(csvStr)
            totalRows += result.rows.length
            isFirst = false
            offset += BATCH
            if (result.rows.length < BATCH) break
          }
          writer.end()
          return { success: true, message: `成功将 ${totalRows} 行数据导出到 ${filePath.split(/[/\\]/).pop()}` }
        } catch (err) {
          writer.end()
          throw err
        }
      }

      if (format === 'json') {
        // 流式 JSON 导出：分批查询 + 逐行写入，避免全量序列化
        const BATCH = 5000
        const writer = createWriteStream(filePath, { encoding: 'utf8' })
        let offset = 0
        let isFirst = true
        let totalRows = 0
        try {
          writer.write('[\n')
          while (true) {
            const result = await this.connectionService.executeQuery(
              connectionId, databaseName,
              `SELECT ${colsToSelect} FROM ${safeTable} LIMIT ${BATCH} OFFSET ${offset}`
            )
            if (!result.success || !result.rows?.length) break
            for (const row of result.rows) {
              if (!isFirst) writer.write(',\n')
              writer.write(JSON.stringify(row))
              isFirst = false
            }
            totalRows += result.rows.length
            offset += BATCH
            if (result.rows.length < BATCH) break
          }
          writer.write('\n]')
          writer.end()
          return { success: true, message: `成功将 ${totalRows} 行数据导出到 ${filePath.split(/[/\\]/).pop()}` }
        } catch (err) {
          writer.end()
          throw err
        }
      } else if (format === 'xlsx') {
        // Excel 导出：XLSX 库不支持流式写入，分批查询后合并写入
        const BATCH = 10000
        const allRows: Array<Record<string, unknown>> = []
        let offset = 0
        while (true) {
          const result = await this.connectionService.executeQuery(
            connectionId, databaseName,
            `SELECT ${colsToSelect} FROM ${safeTable} LIMIT ${BATCH} OFFSET ${offset}`
          )
          if (!result.success || !result.rows?.length) break
          allRows.push(...result.rows)
          offset += BATCH
          if (result.rows.length < BATCH) break
        }
        const worksheet = XLSX.utils.json_to_sheet(allRows, {
          header: selectedColumns && selectedColumns.length > 0 ? selectedColumns : undefined,
          skipHeader: !includeHeader
        })
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, tableName.slice(0, 31))
        const buf = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
        await writeFile(filePath, buf)
        return { success: true, message: `成功将 ${allRows.length} 行数据导出到 ${filePath.split(/[/\\]/).pop()}` }
      }

      return { success: false, message: '不支持的导出格式' }
    } catch (err) {
      return { success: false, message: errorMessage(err) }
    }
  }
}
