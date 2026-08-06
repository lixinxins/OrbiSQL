import { createReadStream } from 'node:fs'
import { stat as fsStat } from 'node:fs/promises'
import type {
  ExportSqlProgress,
  ExportSqlResult,
  PreviewExportSqlResult
} from '../../../shared/connections'
import type { ConnectionService } from '../connection-service'
import { exportMysqlTables } from '../adapters/mysql-adapter'
import { exportPostgreSqlTables } from '../adapters/postgresql-adapter'
import { exportSqliteTables } from '../adapters/sqlite-adapter'
import { errorMessage, quoteIdentifierForEngine, quotePortableString } from './import-utils'
import { reportProgress } from './progress'

/** SQL Dump：整库/单表结构与数据导出、导出预览，含进度回传。 */
export class SqlDump {
  constructor(private readonly connectionService: ConnectionService) {}

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
      reportProgress(onProgress, 0, total, '正在准备导出...')

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

      reportProgress(onProgress, total, total, '导出完成')

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
}
