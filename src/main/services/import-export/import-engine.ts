import { createReadStream } from 'node:fs'
import { readFile, stat as fsStat } from 'node:fs/promises'
import { Parser } from 'csv-parse'
import * as XLSX from 'xlsx'
import type { RowDataPacket } from 'mysql2/promise'
import type { ConnectionActionResult, ExecuteImportInput, PreviewImportResult } from '../../../shared/connections'
import type { StoredConnection } from '../../database/connection-repository'
import type { ConnectionService } from '../connection-service'
import { getMysqlPool } from '../adapters/mysql-adapter'
import { sqliteWorkerQuery } from '../sqlite-runtime'
import { ensureSqliteHandle } from '../adapters/sqlite-adapter'
import { getDmPool } from '../adapters/dm-adapter'
import { getKbPool } from '../adapters/kingbase-adapter'
import { getPostgresPool } from '../adapters/postgresql-adapter'
import type { Pool } from 'pg'
import { computeBatchSize, errorMessage, isMysqlFamily, isPgFamily, quoteIdentifierForEngine, quotePortableString } from './import-utils'

/** 数据导入：CSV/TSV、JSON（流式）、Excel，参数化批量写入。 */
export class ImportEngine {
  constructor(private readonly connectionService: ConnectionService) {}

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
      const escapedCols = columns.map((h) => quoteIdentifierForEngine(connection.engine, h)).join(', ')
      const quotedTable = quoteIdentifierForEngine(connection.engine, tableName)
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
}
