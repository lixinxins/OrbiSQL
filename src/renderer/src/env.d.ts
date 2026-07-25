import type { AppInfo } from '../../preload'
import type {
  AppPreferences,
  ConnectionActionResult,
  ConnectionEnvironment,
  ConnectionGroup,
  ConnectionSecurityFileKind,
  CopyTableInput,
  CreateConnectionInput,
  CreateTableInput,
  DatabaseConnection,
  DatabaseCharsetResult,
  DatabaseDefinitionInput,
  DatabaseItem,
  ExportSqlProgress,
  ExportSqlResult,
  QueryExecutionResult,
  QueryDeleteRowInput,
  QueryUpdateRowInput,
  RenameTableInput,
  SaveQueryInput,
  SavedQuery,
  TableDefinitionResult,
  TableDataFilter,
  TransferTableDataInput,
  UpdateConnectionInput,
  UpdateDatabaseInput,
  UpdateTableInput
} from '../../shared/connections'
import type { AiAgentRequest, AiAgentResponse, AiExecuteProposalRequest, AiModelActionResult, AiModelPreset, AiSaveModelInput, AiStoredModel } from '../../shared/ai-agent'
import type { SshFileActionResult, SshFileEntry, SshFileListResult } from '../../shared/ssh-files'

declare global {
  const __QUILLDB_HARMONY__: boolean

  interface Window {
    orbisqlHarmony?: {
      getPlatform: () => string
      getAppVersion: () => string
      invoke: (method: string, argsJson: string) => string
      selectSqliteFile: (requestId: string) => void
    }
    __orbisqlNativeCallback?: (requestId: string, success: boolean, value: string) => void
    omnidb: {
      getAppInfo: () => Promise<AppInfo>
      onSettingsRequested: (callback: () => void) => () => void
      onAboutRequested: (callback: () => void) => () => void
      updatePreferences: (preferences: AppPreferences) => Promise<void>
      showItemInFolder?: (filePath: string) => Promise<void>
      openPath?: (filePath: string) => Promise<void>
      ai: {
        listModelPresets: () => Promise<AiModelPreset[]>
        listModels: () => Promise<AiStoredModel[]>
        saveModel: (input: AiSaveModelInput) => Promise<AiModelActionResult>
        deleteModel: (id: number) => Promise<AiModelActionResult>
        chat: (request: AiAgentRequest) => Promise<AiAgentResponse>
        executeProposal: (request: AiExecuteProposalRequest) => Promise<AiAgentResponse>
      }
      connections: {
        list: () => Promise<DatabaseConnection[]>
        getOne: (id: number) => Promise<DatabaseConnection | null>
        listGroups: () => Promise<ConnectionGroup[]>
        createGroup: (name: string, category?: 'database' | 'ssh') => Promise<ConnectionActionResult>
        deleteGroup: (id: number) => Promise<ConnectionActionResult>
        setGroup: (connectionId: number, groupId: number | null) => Promise<ConnectionActionResult>
        selectSqliteFile: (engine?: string) => Promise<string | null>
        selectSecurityFile: (kind: ConnectionSecurityFileKind) => Promise<string | null>
        create: (input: CreateConnectionInput) => Promise<ConnectionActionResult>
        update: (input: UpdateConnectionInput) => Promise<ConnectionActionResult>
        updateColor: (id: number, color: string) => Promise<ConnectionActionResult>
        updateEnvironment: (id: number, environment: ConnectionEnvironment | null) => Promise<ConnectionActionResult>
        test: (input: CreateConnectionInput) => Promise<ConnectionActionResult>
        testUpdate: (input: UpdateConnectionInput) => Promise<ConnectionActionResult>
        open: (id: number) => Promise<ConnectionActionResult>
        close: (id: number) => Promise<ConnectionActionResult>
        duplicate: (id: number) => Promise<ConnectionActionResult>
        delete: (id: number, name: string) => Promise<ConnectionActionResult>
        runSqlFile: (id: number, databaseName?: string) => Promise<ConnectionActionResult>
        previewSqlFile: (id: number, databaseName?: string, filePath?: string) => Promise<import('@/shared/connections').PreviewSqlFileResult>
        executeSqlFile: (input: import('@/shared/connections').ExecuteSqlFileInput) => Promise<ConnectionActionResult>
        readDatabaseDetail: (connectionId: number, databaseName: string) => Promise<DatabaseItem | null>
        getProcessList: (id: number) => Promise<import('@/shared/connections').ProcessListResult>
        killProcess: (id: number, processId: string | number) => Promise<import('@/shared/connections').KillProcessResult>
        exportConfig: (options?: { targetPath?: string; selectedIds?: number[]; includePasswords?: boolean }) => Promise<{ success: boolean; message: string; filePath?: string }>
        readImportConfigFile: (sourcePath?: string) => Promise<{ success: boolean; message: string; filePath?: string; groups?: Array<{ name: string; category?: 'database' | 'ssh' }>; connections?: Array<import('@/shared/connections').CreateConnectionInput & { groupName?: string }> }>
        importConfig: (options?: { filePath?: string; sourcePath?: string; groups?: Array<{ name: string; category?: 'database' | 'ssh' }>; connections?: Array<import('@/shared/connections').CreateConnectionInput & { groupName?: string }> }) => Promise<ConnectionActionResult>
        updateSortOrders: (orders: Array<{ id: number; sortOrder: number }>) => Promise<ConnectionActionResult>
        onCreateRequested: (callback: () => void) => () => void
      }
      databases: {
        listCharsets: (connectionId: number) => Promise<DatabaseCharsetResult>
        create: (input: DatabaseDefinitionInput) => Promise<ConnectionActionResult>
        update: (input: UpdateDatabaseInput) => Promise<ConnectionActionResult>
        exportSql: (connectionId: number, databaseName: string, tableName: string | undefined, includeData: boolean) => Promise<import('@/shared/connections').ExportSqlResult>
        previewExportSql: (connectionId: number, databaseName: string, tableName: string | undefined, includeData: boolean, maxRowsPerTable?: number) => Promise<import('@/shared/connections').PreviewExportSqlResult>
        delete: (connectionId: number, databaseName: string) => Promise<ConnectionActionResult>
        onExportSqlProgress?: (callback: (progress: ExportSqlProgress) => void) => (() => void)
      }
      queries: {
        listSaved: (connectionId: number, databaseName: string) => Promise<SavedQuery[]>
        save: (input: SaveQueryInput) => Promise<ConnectionActionResult>
        deleteSaved: (id: number, connectionId: number, databaseName: string) => Promise<ConnectionActionResult>
        execute: (connectionId: number, databaseName: string, sql: string, sessionId?: string) => Promise<QueryExecutionResult>
        fetchMore: (connectionId: number, databaseName: string, cursorId: string) => Promise<{ success: boolean; message: string; rows?: Array<Record<string, unknown>>; done?: boolean; offset?: number; totalRows?: number }>
        beginTransaction: (connectionId: number, databaseName: string, sessionId: string) => Promise<ConnectionActionResult>
        commitTransaction: (sessionId: string) => Promise<ConnectionActionResult>
        rollbackTransaction: (sessionId: string) => Promise<ConnectionActionResult>
        updateRow: (input: QueryUpdateRowInput) => Promise<ConnectionActionResult>
      }
      tables: {
        create: (input: CreateTableInput) => Promise<ConnectionActionResult>
        previewImport: (connectionId: number, databaseName: string, tableName: string, filePath?: string) => Promise<import('@/shared/connections').PreviewImportResult>
        executeImport: (input: import('@/shared/connections').ExecuteImportInput) => Promise<ConnectionActionResult>
        exportCustomData: (input: import('@/shared/connections').ExportTableCustomInput) => Promise<ConnectionActionResult>
        importData: (connectionId: number, databaseName: string, tableName: string) => Promise<ConnectionActionResult>
        importCsv: (connectionId: number, databaseName: string, tableName: string) => Promise<ConnectionActionResult>
        exportCsv: (connectionId: number, databaseName: string, tableName: string) => Promise<ConnectionActionResult>
        delete: (connectionId: number, databaseName: string, tableName: string) => Promise<ConnectionActionResult>
        truncate: (connectionId: number, databaseName: string, tableName: string) => Promise<ConnectionActionResult>
        copy: (input: CopyTableInput) => Promise<ConnectionActionResult>
        transferData: (input: TransferTableDataInput) => Promise<ConnectionActionResult>
        readData: (connectionId: number, databaseName: string, tableName: string, limit: number, offset: number, filter?: TableDataFilter) => Promise<QueryExecutionResult>
        updateRow: (input: QueryUpdateRowInput) => Promise<ConnectionActionResult>
        deleteRow: (input: QueryDeleteRowInput) => Promise<ConnectionActionResult>
        getDefinition: (connectionId: number, databaseName: string, tableName: string) => Promise<TableDefinitionResult>
        update: (input: UpdateTableInput) => Promise<ConnectionActionResult>
        rename: (input: RenameTableInput) => Promise<ConnectionActionResult>
      }
      ssh: {
        connect: (options: {
          sessionId: string
          host: string
          port: number
          username: string
          authType: 'password' | 'privateKey'
          password?: string
          privateKeyPath?: string
          passphrase?: string
          connectionId?: number
        }) => Promise<{ success: boolean; message: string }>
        write: (sessionId: string, data: string) => Promise<void>
        resize: (sessionId: string, rows: number, cols: number) => Promise<void>
        disconnect: (sessionId: string) => Promise<void>
        listFiles: (sessionId: string, remotePath: string) => Promise<SshFileListResult>
        uploadFiles: (sessionId: string, remoteDirectory: string) => Promise<SshFileActionResult>
        downloadFile: (sessionId: string, entry: SshFileEntry) => Promise<SshFileActionResult>
        openFile: (sessionId: string, entry: SshFileEntry) => Promise<SshFileActionResult>
        deleteFile: (sessionId: string, entry: SshFileEntry) => Promise<SshFileActionResult>
        onOutput: (sessionId: string, callback: (data: string) => void) => () => void
        onClosed: (sessionId: string, callback: () => void) => () => void
      }
    }
  }
}

export {}
