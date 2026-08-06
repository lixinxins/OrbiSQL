import { createWriteStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { stringify } from 'csv-stringify/sync'
import * as XLSX from 'xlsx'
import type { ConnectionActionResult, ExportTableCustomInput } from '../../../shared/connections'
import type { ConnectionService } from '../connection-service'
import { quoteMysqlIdentifier } from '../adapters/mysql-adapter'
import { errorMessage, quoteIdentifierForEngine } from './import-utils'

/** 数据导出：CSV 流式导出与 CSV/JSON/Excel 自定义导出。 */
export class ExportEngine {
  constructor(private readonly connectionService: ConnectionService) {}

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

  async exportTableCustom(input: ExportTableCustomInput): Promise<ConnectionActionResult> {
    const { connectionId, databaseName, tableName, format, selectedColumns, includeHeader = true } = input
    let filePath = input.filePath || ''

    const connection = this.connectionService.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    if (!filePath) {
      const { dialog } = await import('electron')
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
