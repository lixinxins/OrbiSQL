import type { AppInfo } from '../../preload'
import type {
  AppPreferences,
  ConnectionActionResult,
  ConnectionGroup,
  ConnectionSecurityFileKind,
  CopyTableInput,
  CreateConnectionInput,
  CreateTableInput,
  DatabaseConnection,
  DatabaseCharsetResult,
  DatabaseDefinitionInput,
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

declare global {
  const __ORBISQL_HARMONY__: boolean

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
        listGroups: () => Promise<ConnectionGroup[]>
        createGroup: (name: string) => Promise<ConnectionActionResult>
        deleteGroup: (id: number) => Promise<ConnectionActionResult>
        setGroup: (connectionId: number, groupId: number | null) => Promise<ConnectionActionResult>
        selectSqliteFile: () => Promise<string | null>
        selectSecurityFile: (kind: ConnectionSecurityFileKind) => Promise<string | null>
        create: (input: CreateConnectionInput) => Promise<ConnectionActionResult>
        update: (input: UpdateConnectionInput) => Promise<ConnectionActionResult>
        test: (input: CreateConnectionInput) => Promise<ConnectionActionResult>
        testUpdate: (input: UpdateConnectionInput) => Promise<ConnectionActionResult>
        open: (id: number) => Promise<ConnectionActionResult>
        close: (id: number) => Promise<ConnectionActionResult>
        duplicate: (id: number) => Promise<ConnectionActionResult>
        delete: (id: number, name: string) => Promise<ConnectionActionResult>
        runSqlFile: (id: number, databaseName?: string) => Promise<ConnectionActionResult>
        onCreateRequested: (callback: () => void) => () => void
      }
      databases: {
        listCharsets: (connectionId: number) => Promise<DatabaseCharsetResult>
        create: (input: DatabaseDefinitionInput) => Promise<ConnectionActionResult>
        update: (input: UpdateDatabaseInput) => Promise<ConnectionActionResult>
        exportSql: (connectionId: number, databaseName: string, tableName: string | undefined, includeData: boolean) => Promise<ConnectionActionResult>
        delete: (connectionId: number, databaseName: string) => Promise<ConnectionActionResult>
      }
      queries: {
        listSaved: (connectionId: number, databaseName: string) => Promise<SavedQuery[]>
        save: (input: SaveQueryInput) => Promise<ConnectionActionResult>
        deleteSaved: (id: number, connectionId: number, databaseName: string) => Promise<ConnectionActionResult>
        execute: (connectionId: number, databaseName: string, sql: string, sessionId?: string) => Promise<QueryExecutionResult>
        beginTransaction: (connectionId: number, databaseName: string, sessionId: string) => Promise<ConnectionActionResult>
        commitTransaction: (sessionId: string) => Promise<ConnectionActionResult>
        rollbackTransaction: (sessionId: string) => Promise<ConnectionActionResult>
        updateRow: (input: QueryUpdateRowInput) => Promise<ConnectionActionResult>
      }
      tables: {
        create: (input: CreateTableInput) => Promise<ConnectionActionResult>
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
    }
  }
}

export {}
