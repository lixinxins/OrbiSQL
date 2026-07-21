import type { AppInfo } from '../../preload'
import type {
  AppPreferences,
  ConnectionActionResult,
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
  UpdateConnectionInput,
  UpdateDatabaseInput,
  UpdateTableInput
} from '../../shared/connections'
import type { AiAgentRequest, AiAgentResponse, AiExecuteProposalRequest, AiModelActionResult, AiModelPreset, AiSaveModelInput, AiStoredModel } from '../../shared/ai-agent'

declare global {
  interface Window {
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
        selectSqliteFile: () => Promise<string | null>
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
        execute: (connectionId: number, databaseName: string, sql: string) => Promise<QueryExecutionResult>
        updateRow: (input: QueryUpdateRowInput) => Promise<ConnectionActionResult>
      }
      tables: {
        create: (input: CreateTableInput) => Promise<ConnectionActionResult>
        importCsv: (connectionId: number, databaseName: string, tableName: string) => Promise<ConnectionActionResult>
        exportCsv: (connectionId: number, databaseName: string, tableName: string) => Promise<ConnectionActionResult>
        delete: (connectionId: number, databaseName: string, tableName: string) => Promise<ConnectionActionResult>
        truncate: (connectionId: number, databaseName: string, tableName: string) => Promise<ConnectionActionResult>
        copy: (input: CopyTableInput) => Promise<ConnectionActionResult>
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
