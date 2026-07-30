import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '../shared/ipc-channels'
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
  ExecuteImportInput,
  ExecuteSqlFileInput,
  ExportSqlProgress,
  ExportSqlResult,
  ExportTableCustomInput,
  PreviewExportSqlResult,
  PreviewImportResult,
  PreviewSqlFileResult,
  ProcessListResult,
  KillProcessResult,
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
  UpdateTableInput,
  WorkspaceStats
} from '../shared/connections'
import type { AiAgentRequest, AiAgentResponse, AiExecuteProposalRequest, AiModelActionResult, AiModelPreset, AiSaveModelInput, AiStoredModel } from '../shared/ai-agent'
import type { SshFileActionResult, SshFileEntry, SshFileListResult } from '../shared/ssh-files'

export interface AppInfo {
  name: string
  version: string
  platform: NodeJS.Platform | 'harmonyos'
}

contextBridge.exposeInMainWorld('omnidb', {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannel.app.getInfo),
  onSettingsRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannel.app.openSettings, listener)
    return () => ipcRenderer.removeListener(IpcChannel.app.openSettings, listener)
  },
  onAboutRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannel.app.openAbout, listener)
    return () => ipcRenderer.removeListener(IpcChannel.app.openAbout, listener)
  },
  updatePreferences: (preferences: AppPreferences): Promise<void> => ipcRenderer.invoke(IpcChannel.app.updatePreferences, preferences),
  showItemInFolder: (filePath: string): Promise<void> => ipcRenderer.invoke(IpcChannel.app.showItemInFolder, filePath),
  openPath: (filePath: string): Promise<void> => ipcRenderer.invoke(IpcChannel.app.openPath, filePath),
  ai: {
    listModelPresets: (): Promise<AiModelPreset[]> => ipcRenderer.invoke(IpcChannel.ai.listModelPresets),
    listModels: (): Promise<AiStoredModel[]> => ipcRenderer.invoke(IpcChannel.ai.listModels),
    saveModel: (input: AiSaveModelInput): Promise<AiModelActionResult> => ipcRenderer.invoke(IpcChannel.ai.saveModel, input),
    deleteModel: (id: number): Promise<AiModelActionResult> => ipcRenderer.invoke(IpcChannel.ai.deleteModel, id),
    chat: (request: AiAgentRequest): Promise<AiAgentResponse> => ipcRenderer.invoke(IpcChannel.ai.chat, request),
    executeProposal: (request: AiExecuteProposalRequest): Promise<AiAgentResponse> => ipcRenderer.invoke(IpcChannel.ai.executeProposal, request)
  },
  connections: {
    list: (): Promise<DatabaseConnection[]> => ipcRenderer.invoke(IpcChannel.connections.list),
    getOne: (id: number): Promise<DatabaseConnection | null> => ipcRenderer.invoke(IpcChannel.connections.getOne, id),
    listGroups: (): Promise<ConnectionGroup[]> => ipcRenderer.invoke(IpcChannel.connections.listGroups),
    createGroup: (name: string, category?: 'database' | 'ssh'): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.createGroup, name, category),
    deleteGroup: (id: number): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.deleteGroup, id),
    renameGroup: (id: number, name: string): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.renameGroup, id, name),
    setGroup: (connectionId: number, groupId: number | null): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.setGroup, connectionId, groupId),
    selectSqliteFile: (engine?: string): Promise<string | null> => ipcRenderer.invoke(IpcChannel.connections.selectSqliteFile, engine),
    selectSecurityFile: (kind: ConnectionSecurityFileKind): Promise<string | null> => ipcRenderer.invoke(IpcChannel.connections.selectSecurityFile, kind),
    create: (input: CreateConnectionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.create, input),
    update: (input: UpdateConnectionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.update, input),
    updateColor: (id: number, color: string): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.updateColor, id, color),
    updateEnvironment: (id: number, environment: ConnectionEnvironment | null): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.updateEnvironment, id, environment),
    test: (input: CreateConnectionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.test, input),
    testUpdate: (input: UpdateConnectionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.testUpdate, input),
    open: (id: number): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.open, id),
    close: (id: number): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.close, id),
    duplicate: (id: number): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.duplicate, id),
    delete: (id: number, name: string): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.delete, id, name),
    readDatabaseDetail: (connectionId: number, databaseName: string): Promise<DatabaseItem | null> =>
      ipcRenderer.invoke(IpcChannel.connections.readDatabaseDetail, connectionId, databaseName),
    runSqlFile: (id: number, databaseName?: string): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.connections.runSqlFile, id, databaseName),
    previewSqlFile: (id: number, databaseName?: string, filePath?: string): Promise<PreviewSqlFileResult> =>
      ipcRenderer.invoke(IpcChannel.connections.previewSqlFile, id, databaseName, filePath),
    executeSqlFile: (input: ExecuteSqlFileInput): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.connections.executeSqlFile, input),
    getProcessList: (id: number): Promise<ProcessListResult> =>
      ipcRenderer.invoke(IpcChannel.connections.getProcessList, id),
    killProcess: (id: number, processId: string | number): Promise<KillProcessResult> =>
      ipcRenderer.invoke(IpcChannel.connections.killProcess, id, processId),
    exportConfig: (options?: { targetPath?: string; selectedIds?: number[]; includePasswords?: boolean }): Promise<{ success: boolean; message: string; filePath?: string }> =>
      ipcRenderer.invoke(IpcChannel.connections.exportConfig, options),
    readImportConfigFile: (sourcePath?: string): Promise<{ success: boolean; message: string; filePath?: string; groups?: Array<{ name: string; category?: 'database' | 'ssh' }>; connections?: Array<import('@/shared/connections').CreateConnectionInput & { groupName?: string }> }> =>
      ipcRenderer.invoke(IpcChannel.connections.readImportConfigFile, sourcePath),
    importConfig: (options?: { filePath?: string; sourcePath?: string; groups?: Array<{ name: string; category?: 'database' | 'ssh' }>; connections?: Array<import('@/shared/connections').CreateConnectionInput & { groupName?: string }> }): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.connections.importConfig, options),
    updateSortOrders: (orders: Array<{ id: number; sortOrder: number }>): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.connections.updateSortOrders, orders),
    onCreateRequested: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on(IpcChannel.connections.openCreateDialog, listener)
      return () => ipcRenderer.removeListener(IpcChannel.connections.openCreateDialog, listener)
    }
  },
  databases: {
    listCharsets: (connectionId: number): Promise<DatabaseCharsetResult> => ipcRenderer.invoke(IpcChannel.databases.listCharsets, connectionId),
    create: (input: DatabaseDefinitionInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.databases.create, input),
    update: (input: UpdateDatabaseInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.databases.update, input),
    exportSql: (connectionId: number, databaseName: string, tableName: string | undefined, includeData: boolean): Promise<ExportSqlResult> =>
      ipcRenderer.invoke(IpcChannel.databases.exportSql, connectionId, databaseName, tableName, includeData),
    previewExportSql: (connectionId: number, databaseName: string, tableName: string | undefined, includeData: boolean, maxRowsPerTable?: number): Promise<PreviewExportSqlResult> =>
      ipcRenderer.invoke(IpcChannel.databases.previewExportSql, connectionId, databaseName, tableName, includeData, maxRowsPerTable),
    delete: (connectionId: number, databaseName: string): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.databases.delete, connectionId, databaseName),
    onExportSqlProgress: (callback: (progress: ExportSqlProgress) => void): (() => void) => {
      const listener = (_event: unknown, data: ExportSqlProgress): void => callback(data)
      ipcRenderer.on(IpcChannel.databases.exportSqlProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannel.databases.exportSqlProgress, listener)
    }
  },
  queries: {
    listSaved: (connectionId: number, databaseName: string): Promise<SavedQuery[]> =>
      ipcRenderer.invoke(IpcChannel.queries.listSaved, connectionId, databaseName),
    save: (input: SaveQueryInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.queries.save, input),
    deleteSaved: (id: number, connectionId: number, databaseName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.queries.deleteSaved, id, connectionId, databaseName),
    execute: (connectionId: number, databaseName: string, sql: string, sessionId?: string): Promise<QueryExecutionResult> =>
      ipcRenderer.invoke(IpcChannel.queries.execute, connectionId, databaseName, sql, sessionId),
    fetchMore: (connectionId: number, databaseName: string, cursorId: string) =>
      ipcRenderer.invoke(IpcChannel.queries.fetchMore, connectionId, databaseName, cursorId),
    beginTransaction: (connectionId: number, databaseName: string, sessionId: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.queries.transactionBegin, connectionId, databaseName, sessionId),
    commitTransaction: (sessionId: string): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.queries.transactionCommit, sessionId),
    rollbackTransaction: (sessionId: string): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.queries.transactionRollback, sessionId),
    updateRow: (input: QueryUpdateRowInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.queries.updateRow, input)
  },
  tables: {
    create: (input: CreateTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.tables.create, input),
    previewImport: (connectionId: number, databaseName: string, tableName: string, filePath?: string): Promise<PreviewImportResult> =>
      ipcRenderer.invoke(IpcChannel.tables.previewImport, connectionId, databaseName, tableName, filePath),
    executeImport: (input: ExecuteImportInput): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.tables.executeImport, input),
    importData: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.tables.previewImport, connectionId, databaseName, tableName),
    importCsv: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.tables.importCsv, connectionId, databaseName, tableName),
    exportCsv: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.tables.exportCsv, connectionId, databaseName, tableName),
    exportCustomData: (input: ExportTableCustomInput): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.tables.exportCustomData, input),
    delete: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.tables.delete, connectionId, databaseName, tableName),
    truncate: (connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> =>
      ipcRenderer.invoke(IpcChannel.tables.truncate, connectionId, databaseName, tableName),
    copy: (input: CopyTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.tables.copy, input),
    transferData: (input: TransferTableDataInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.tables.transferData, input),
    readData: (connectionId: number, databaseName: string, tableName: string, limit: number, offset: number, filter?: TableDataFilter): Promise<QueryExecutionResult> =>
      ipcRenderer.invoke(IpcChannel.tables.readData, connectionId, databaseName, tableName, limit, offset, filter),
    updateRow: (input: QueryUpdateRowInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.tables.updateRow, input),
    deleteRow: (input: QueryDeleteRowInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.tables.deleteRow, input),
    getDefinition: (connectionId: number, databaseName: string, tableName: string): Promise<TableDefinitionResult> =>
      ipcRenderer.invoke(IpcChannel.tables.getDefinition, connectionId, databaseName, tableName),
    update: (input: UpdateTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.tables.update, input),
    rename: (input: RenameTableInput): Promise<ConnectionActionResult> => ipcRenderer.invoke(IpcChannel.tables.rename, input)
  },
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
    }): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke(IpcChannel.ssh.connect, options),
    write: (sessionId: string, data: string): Promise<void> => ipcRenderer.invoke(IpcChannel.ssh.write, sessionId, data),
    resize: (sessionId: string, rows: number, cols: number): Promise<void> => ipcRenderer.invoke(IpcChannel.ssh.resize, sessionId, rows, cols),
    disconnect: (sessionId: string): Promise<void> => ipcRenderer.invoke(IpcChannel.ssh.disconnect, sessionId),
    listFiles: (sessionId: string, remotePath: string): Promise<SshFileListResult> => ipcRenderer.invoke(IpcChannel.ssh.filesList, sessionId, remotePath),
    uploadFiles: (sessionId: string, remoteDirectory: string): Promise<SshFileActionResult> => ipcRenderer.invoke(IpcChannel.ssh.filesUpload, sessionId, remoteDirectory),
    downloadFile: (sessionId: string, entry: SshFileEntry): Promise<SshFileActionResult> => ipcRenderer.invoke(IpcChannel.ssh.filesDownload, sessionId, entry.path, entry.name),
    openFile: (sessionId: string, entry: SshFileEntry): Promise<SshFileActionResult> => ipcRenderer.invoke(IpcChannel.ssh.filesOpen, sessionId, entry.path, entry.name),
    deleteFile: (sessionId: string, entry: SshFileEntry): Promise<SshFileActionResult> => ipcRenderer.invoke(IpcChannel.ssh.filesDelete, sessionId, entry.path, entry.type),
    onOutput: (sessionId: string, callback: (data: string) => void): (() => void) => {
      const channel = IpcChannel.ssh.output(sessionId)
      // A terminal session has exactly one renderer consumer. Clearing the
      // channel also removes listeners left behind by reconnect/HMR cycles.
      ipcRenderer.removeAllListeners(channel)
      const listener = (_event: unknown, data: string): void => callback(data)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    onClosed: (sessionId: string, callback: () => void): (() => void) => {
      const channel = IpcChannel.ssh.closed(sessionId)
      ipcRenderer.removeAllListeners(channel)
      const listener = (): void => callback()
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  memory: {
    getStats: (): Promise<{ rssMB: number; heapTotalMB: number; heapUsedMB: number; externalMB: number; arrayBuffersMB: number; timestamp: number }> =>
      ipcRenderer.invoke(IpcChannel.memory.getStats),
    takeHeapSnapshot: (): Promise<string> =>
      ipcRenderer.invoke(IpcChannel.memory.takeHeapSnapshot),
    forceGc: (): Promise<{ success: boolean; message: string }> =>
      ipcRenderer.invoke(IpcChannel.memory.forceGc)
  },
  workspace: {
    getStats: (range?: '7d' | '30d' | '90d'): Promise<WorkspaceStats> => ipcRenderer.invoke(IpcChannel.workspace.getStats, range)
  }
})
