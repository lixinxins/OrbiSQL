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
import type { ConnectionService } from './connection-service'
import { ExportEngine } from './import-export/export-engine'
import { ImportEngine } from './import-export/import-engine'
import { SqlDump } from './import-export/sql-dump'
import { TransferEngine } from './import-export/transfer'

/**
 * 导入导出服务门面：按职责把实现下沉到 import-export/ 下的领域模块
 * （导入 / 导出 / SQL Dump / 数据传输 / 进度回传），对外方法签名保持不变。
 */
export class ImportExportService {
  private readonly importEngine: ImportEngine
  private readonly exportEngine: ExportEngine
  private readonly sqlDump: SqlDump
  private readonly transferEngine: TransferEngine

  constructor(
    connectionService: ConnectionService
  ) {
    this.importEngine = new ImportEngine(connectionService)
    this.exportEngine = new ExportEngine(connectionService)
    this.sqlDump = new SqlDump(connectionService)
    this.transferEngine = new TransferEngine(connectionService)
  }

  async importTableData(
    connectionId: number,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<ConnectionActionResult> {
    return this.importEngine.importTableData(connectionId, databaseName, tableName, filePath)
  }

  async previewImportFile(
    connectionId: number,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<PreviewImportResult> {
    return this.importEngine.previewImportFile(connectionId, databaseName, tableName, filePath)
  }

  async executeImportWithMapping(input: ExecuteImportInput): Promise<ConnectionActionResult> {
    return this.importEngine.executeImportWithMapping(input)
  }

  async importTableCsv(connectionId: number, databaseName: string, tableName: string, filePath: string): Promise<ConnectionActionResult> {
    return this.importEngine.importTableCsv(connectionId, databaseName, tableName, filePath)
  }

  async exportTableCsv(
    connectionId: number,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<ConnectionActionResult> {
    return this.exportEngine.exportTableCsv(connectionId, databaseName, tableName, filePath)
  }

  async transferTableData(input: TransferTableDataInput): Promise<ConnectionActionResult> {
    return this.transferEngine.transferTableData(input)
  }

  async exportSql(
    connectionId: number,
    databaseName: string,
    filePath: string,
    includeData: boolean,
    tableName?: string,
    onProgress?: (progress: ExportSqlProgress) => void
  ): Promise<ExportSqlResult> {
    return this.sqlDump.exportSql(connectionId, databaseName, filePath, includeData, tableName, onProgress)
  }

  async previewExportSql(
    connectionId: number,
    databaseName: string,
    includeData: boolean,
    tableName?: string,
    maxRowsPerTable: number = 50
  ): Promise<PreviewExportSqlResult> {
    return this.sqlDump.previewExportSql(connectionId, databaseName, includeData, tableName, maxRowsPerTable)
  }

  async exportTableCustom(input: ExportTableCustomInput): Promise<ConnectionActionResult> {
    return this.exportEngine.exportTableCustom(input)
  }
}
