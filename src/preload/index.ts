import { contextBridge, ipcRenderer } from 'electron'
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
} from '../shared/connections'
import type { AiAgentRequest, AiAgentResponse, AiExecuteProposalRequest, AiModelActionResult, AiModelPreset, AiSaveModelInput, AiStoredModel } from '../shared/ai-agent'

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform | 'harmonyos'
}

contextBridge.exposeInMainWorld('omnidb', {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),
  onSettingsRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:open-settings', listener)
    return () => ipcRenderer.removeListener('app:open-settings', listener)
  },
  onAboutRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:open-about', listener)
    return () => ipcRenderer.removeListener('app:open-about', listener)
  },
  updatePreferences: (preferences: AppPreferences): Promise<void> => ipcRenderer.invoke('app:update-preferences', preferences),
  ai: {
    listModelPresets: (): Promise<AiModelPreset[]> => ipcRenderer.invoke('ai:list-model-presets'),
    listModels: (): Promise<AiStoredModel[]> => ipcRenderer.invoke('ai:list-models'),
    saveModel: (input: AiSaveModelInput): Promise<AiModelActionResult> => ipcRenderer.invoke('ai:save-model', input),
    deleteModel: (id: number): Promise<AiModelActionResult> => ipcRenderer.invoke('ai:delete-model', id),
    chat: (request: AiAgentRequest): Promise<AiAgentResponse> => ipcRenderer.invoke('ai:chat', request),
    executeProposal: (request: AiExecuteProposalRequest): Promise<AiAgentResponse> => ipcRenderer.invoke('ai:execute-proposal', request)
  },
  connections: {
    list: (): Promise<DatabaseConnection[]> => ipcRenderer.invoke('connections:list'),
    listGroups: (): Promise<ConnectionGroup[]> => ipcRenderer.invoke('connections:list-groups'),
    createGroup: (name: string): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:create-group', name),
    deleteGroup: (id: number): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:delete-group', id),
    setGroup: (connectionId: number, groupId: number | null): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:set-group', connectionId, groupId),
    selectSqliteFile: (): Promise<string | null> => ipcRenderer.invoke('connections:select-sqlite-file'),
    selectSecurityFile: (kind: ConnectionSecurityFileKind): Promise<string | null> => ipcRenderer.invoke('connections:select-security-file', kind),
    create: (input: CreateConnectionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:create', input),
    update: (input: UpdateConnectionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:update', input),
    test: (input: CreateConnectionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:test', input),
    testUpdate: (input: UpdateConnectionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:test-update', input),
    open: (id: number): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:open', id),
    close: (id: number): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:close', id),
    duplicate: (id: number): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:duplicate', id),
    delete: (id: number, name: string): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:delete', id, name),
    runSqlFile: (id: number, databaseName?: string): Promise<ConnectionActionResult> => ipcRenderer.invoke('connections:run-sql-file', id, databaseName),
    onCreateRequested: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('connections:open-create-dialog', listener)
      return () => ipcRenderer.removeListener('connections:open-create-dialog', listener)
    }
  },
  databases: {
    listCharsets: (connectionId: number): Promise<DatabaseCharsetResult> => ipcRenderer.invoke('databases:list-charsets', connectionId),
    create: (input: DatabaseDefinitionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('databases:create', input),
    update: (input: UpdateDatabaseInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('databases:update', input),
    exportSql: (connectionId: number, databaseName: string, tableName: string | undefined, includeData: boolean): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('databases:export-sql', connectionId, databaseName, tableName, includeData),
    delete: (connectionId: number, databaseName: string): Promise<ConnectionActionResult> => ipcRenderer.invoke('databases:delete', connectionId, databaseName)
  },
  queries: {
    listSaved: (connectionId: number, databaseName: string): Promise<SavedQuery[]> =>
      ipcRenderer.invoke('queries:list-saved', connectionId, databaseName),
    save: (input: SaveQueryInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('queries:save', input),
    deleteSaved: (id: number, connectionId: number, databaseName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('queries:delete-saved', id, connectionId, databaseName),
    execute: (connectionId: number, databaseName: string, sql: string, sessionId?: string): Promise<QueryExecutionResult> =>
      ipcRenderer.invoke('queries:execute', connectionId, databaseName, sql, sessionId),
    beginTransaction: (connectionId: number, databaseName: string, sessionId: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('queries:transaction-begin', connectionId, databaseName, sessionId),
    commitTransaction: (sessionId: string): Promise<ConnectionActionResult> => ipcRenderer.invoke('queries:transaction-commit', sessionId),
    rollbackTransaction: (sessionId: string): Promise<ConnectionActionResult> => ipcRenderer.invoke('queries:transaction-rollback', sessionId),
    updateRow: (input: QueryUpdateRowInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('queries:update-row', input)
  },
  tables: {
    create: (input: CreateTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('tables:create', input),
    importData: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('tables:import-data', connectionId, databaseName, tableName),
    importCsv: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('tables:import-csv', connectionId, databaseName, tableName),
    exportCsv: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('tables:export-csv', connectionId, databaseName, tableName),
    delete: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('tables:delete', connectionId, databaseName, tableName),
    truncate: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('tables:truncate', connectionId, databaseName, tableName),
    copy: (input: CopyTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('tables:copy', input),
    transferData: (input: TransferTableDataInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('tables:transfer-data', input),
    readData: (connectionId: number, databaseName: string, tableName: string, limit: number, offset: number, filter?: TableDataFilter): Promise<QueryExecutionResult> =>
      ipcRenderer.invoke('tables:read-data', connectionId, databaseName, tableName, limit, offset, filter),
    updateRow: (input: QueryUpdateRowInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('queries:update-row', input),
    deleteRow: (input: QueryDeleteRowInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('tables:delete-row', input),
    getDefinition: (connectionId: number, databaseName: string, tableName: string): Promise<TableDefinitionResult> =>
      ipcRenderer.invoke('tables:get-definition', connectionId, databaseName, tableName),
    update: (input: UpdateTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('tables:update', input),
    rename: (input: RenameTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('tables:rename', input)
  }
})
