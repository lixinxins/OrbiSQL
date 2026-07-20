import { contextBridge, ipcRenderer } from 'electron'
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
} from '../shared/connections'

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform
}

contextBridge.exposeInMainWorld('omnidb', {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:get-info'),
  onSettingsRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('app:open-settings', listener)
    return () => ipcRenderer.removeListener('app:open-settings', listener)
  },
  updatePreferences: (preferences: AppPreferences): Promise<void> => ipcRenderer.invoke('app:update-preferences', preferences),
  connections: {
    list: (): Promise<DatabaseConnection[]> => ipcRenderer.invoke('connections:list'),
    selectSqliteFile: (): Promise<string | null> => ipcRenderer.invoke('connections:select-sqlite-file'),
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
    execute: (connectionId: number, databaseName: string, sql: string): Promise<QueryExecutionResult> =>
      ipcRenderer.invoke('queries:execute', connectionId, databaseName, sql),
    updateRow: (input: QueryUpdateRowInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('queries:update-row', input)
  },
  tables: {
    create: (input: CreateTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('tables:create', input),
    importCsv: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('tables:import-csv', connectionId, databaseName, tableName),
    exportCsv: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('tables:export-csv', connectionId, databaseName, tableName),
    delete: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('tables:delete', connectionId, databaseName, tableName),
    truncate: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke('tables:truncate', connectionId, databaseName, tableName),
    copy: (input: CopyTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke('tables:copy', input),
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
