import type { ConnectionActionResult, TransferTableDataInput } from '../../../shared/connections'
import type { ConnectionService } from '../connection-service'
import { errorMessage, quoteIdentifierForEngine, quotePortableString } from './import-utils'

/** 跨连接数据传输：同名字段分页读取 + 批量写入。 */
export class TransferEngine {
  constructor(private readonly connectionService: ConnectionService) {}

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
}
