import type {
  AppPreferences,
  ConnectionActionResult,
  ConnectionEnvironment,
  ConnectionGroup,
  CopyTableInput,
  CreateConnectionInput,
  CreateTableInput,
  DatabaseCharsetResult,
  DatabaseConnection,
  DatabaseDefinitionInput,
  ExportSqlProgress,
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput,
  RenameTableInput,
  SaveQueryInput,
  SavedQuery,
  TableDataFilter,
  TransferTableDataInput,
  TableDefinitionResult,
  UpdateConnectionInput,
  UpdateDatabaseInput,
  UpdateTableInput
} from '@/shared/connections'
import type {
  AiAgentRequest,
  AiAgentResponse,
  AiExecuteProposalRequest,
  AiModelActionResult,
  AiModelPreset,
  AiSaveModelInput,
  AiStoredModel
} from '@/shared/ai-agent'

interface NativeEnvelope<T> {
  success: boolean
  data?: T
  message?: string
}

interface NativePendingRequest {
  resolve: (value: string | null) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const nativePendingRequests = new Map<string, NativePendingRequest>()

function installNativeCallback(): void {
  if (window.__orbisqlNativeCallback) return
  window.__orbisqlNativeCallback = (requestId, success, value) => {
    const pending = nativePendingRequests.get(requestId)
    if (!pending) return
    clearTimeout(pending.timeout)
    nativePendingRequests.delete(requestId)
    if (success) pending.resolve(value || null)
    else pending.reject(new Error(value || 'SQLite 文件选择失败'))
  }
}

function selectNativeSqliteFile(): Promise<string | null> {
  const nativeBridge = window.orbisqlHarmony
  if (!nativeBridge?.selectSqliteFile) return Promise.reject(new Error('鸿蒙文件选择服务尚未就绪'))
  installNativeCallback()
  const requestId = `sqlite-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      nativePendingRequests.delete(requestId)
      reject(new Error('SQLite 文件选择超时，请重新尝试'))
    }, 120_000)
    nativePendingRequests.set(requestId, { resolve, reject, timeout })
    nativeBridge.selectSqliteFile(requestId)

    // ArkWeb must initiate the system picker from an HTML file control. The
    // native onShowFileSelector callback performs the actual import and sends
    // the sandbox path back through __orbisqlNativeCallback.
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.db,.db3,.sqlite,.sqlite3'
    input.tabIndex = -1
    input.style.position = 'fixed'
    input.style.width = '1px'
    input.style.height = '1px'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'
    input.addEventListener('change', () => input.remove(), { once: true })
    document.body.appendChild(input)
    input.click()
    window.setTimeout(() => input.remove(), 120_000)
  })
}

async function invokeDevice<T>(method: string, args: unknown[] = []): Promise<T> {
  const nativeBridge = window.orbisqlHarmony
  if (!nativeBridge?.invoke) throw new Error('鸿蒙设备数据库服务尚未就绪，请重新打开应用')
  const payload = JSON.parse(nativeBridge.invoke(method, JSON.stringify(args))) as NativeEnvelope<T>
  if (payload.success === false) {
    throw new Error(payload.message || '设备端数据库操作失败')
  }
  return payload.data as T
}

function createHarmonyApi(): Window['omnidb'] {
  const action = (method: string, args: unknown[] = []): Promise<ConnectionActionResult> =>
    invokeDevice<ConnectionActionResult>(method, args).catch((error: unknown) => ({
      success: false,
      message: error instanceof Error ? error.message : '设备端数据库操作失败'
    }))

  return {
    getAppInfo: async () => ({
      name: 'QuillDB',
      version: window.orbisqlHarmony?.getAppVersion() || '0.1.0',
      platform: 'harmonyos'
    }),
    onSettingsRequested: () => () => undefined,
    onAboutRequested: () => () => undefined,
    updatePreferences: (preferences: AppPreferences) => invokeDevice<void>('preferences:update', [preferences]),
    showItemInFolder: (filePath: string) => action('app:show-item-in-folder', [filePath]).then(() => undefined),
    openPath: (filePath: string) => action('app:open-path', [filePath]).then(() => undefined),
    ai: {
      listModelPresets: () => invokeDevice<AiModelPreset[]>('ai:list-model-presets'),
      listModels: () => invokeDevice<AiStoredModel[]>('ai:list-models'),
      saveModel: (input: AiSaveModelInput) => invokeDevice<AiModelActionResult>('ai:save-model', [input]),
      deleteModel: (id: number) => invokeDevice<AiModelActionResult>('ai:delete-model', [id]),
      chat: (request: AiAgentRequest) => invokeDevice<AiAgentResponse>('ai:chat', [request]),
      executeProposal: (request: AiExecuteProposalRequest) => invokeDevice<AiAgentResponse>('ai:execute-proposal', [request])
    },
    connections: {
      list: () => invokeDevice<DatabaseConnection[]>('connections:list'),
      getOne: (id: number) => invokeDevice<DatabaseConnection | null>('connections:get-one', [id]),
      listGroups: () => invokeDevice<ConnectionGroup[]>('connections:list-groups'),
      createGroup: (name: string, category?: 'database' | 'ssh') => action('connections:create-group', [name, category]),
      deleteGroup: (id: number) => action('connections:delete-group', [id]),
      setGroup: (connectionId: number, groupId: number | null) => action('connections:set-group', [connectionId, groupId]),
      selectSqliteFile: selectNativeSqliteFile,
      selectSecurityFile: async () => null,
      create: (input: CreateConnectionInput) => action('connections:create', [input]),
      update: (input: UpdateConnectionInput) => action('connections:update', [input]),
      updateColor: (id: number, color: string) => action('connections:update-color', [id, color]),
      updateEnvironment: (id: number, environment: ConnectionEnvironment | null) => action('connections:update-environment', [id, environment]),
      test: (input: CreateConnectionInput) => action('connections:test', [input]),
      testUpdate: (input: UpdateConnectionInput) => action('connections:test-update', [input]),
      open: (id: number) => action('connections:open', [id]),
      close: (id: number) => action('connections:close', [id]),
      duplicate: (id: number) => action('connections:duplicate', [id]),
      delete: (id: number, name: string) => action('connections:delete', [id, name]),
      readDatabaseDetail: (connectionId: number, databaseName: string) =>
        invokeDevice<import('@/shared/connections').DatabaseItem | null>('connections:read-database-detail', [connectionId, databaseName]),
      runSqlFile: (id: number, databaseName?: string) => action('connections:run-sql-file', [id, databaseName]),
      previewSqlFile: (id: number, databaseName?: string, filePath?: string) =>
        invokeDevice<import('@/shared/connections').PreviewSqlFileResult>('connections:preview-sql-file', [id, databaseName, filePath]),
      executeSqlFile: (input: import('@/shared/connections').ExecuteSqlFileInput) =>
        action('connections:execute-sql-file', [input]),
      getProcessList: (id: number) =>
        invokeDevice<import('@/shared/connections').ProcessListResult>('connections:get-process-list', [id]),
      killProcess: (id: number, processId: string | number) =>
        action('connections:kill-process', [id, processId]),
      exportConfig: (options?: { targetPath?: string; selectedIds?: number[]; includePasswords?: boolean }) =>
        invokeDevice<{ success: boolean; message: string; filePath?: string }>('connections:export-config', [options]),
      readImportConfigFile: (sourcePath?: string) =>
        invokeDevice<{ success: boolean; message: string; filePath?: string; groups?: Array<{ name: string; category?: 'database' | 'ssh' }>; connections?: Array<import('@/shared/connections').CreateConnectionInput & { groupName?: string }> }>('connections:read-import-config-file', [sourcePath]),
      importConfig: (options?: { filePath?: string; sourcePath?: string; groups?: Array<{ name: string; category?: 'database' | 'ssh' }>; connections?: Array<import('@/shared/connections').CreateConnectionInput & { groupName?: string }> }) =>
        action('connections:import-config', [options]),
      updateSortOrders: (orders: Array<{ id: number; sortOrder: number }>) =>
        action('connections:update-sort-orders', [orders]),
      onCreateRequested: () => () => undefined
    },
    databases: {
      listCharsets: (connectionId: number) => invokeDevice<DatabaseCharsetResult>('databases:list-charsets', [connectionId]),
      create: (input: DatabaseDefinitionInput) => action('databases:create', [input]),
      update: (input: UpdateDatabaseInput) => action('databases:update', [input]),
      exportSql: (connectionId: number, databaseName: string, tableName: string | undefined, includeData: boolean) =>
        action('databases:export-sql', [connectionId, databaseName, tableName, includeData]),
      previewExportSql: (connectionId: number, databaseName: string, tableName: string | undefined, includeData: boolean, maxRowsPerTable?: number) =>
        invokeDevice<import('@/shared/connections').PreviewExportSqlResult>('databases:preview-export-sql', [connectionId, databaseName, tableName, includeData, maxRowsPerTable]),
      delete: (connectionId: number, databaseName: string) => action('databases:delete', [connectionId, databaseName]),
      onExportSqlProgress: (callback: (progress: ExportSqlProgress) => void) =>
        window.omnidb?.databases?.onExportSqlProgress?.(callback) ?? (() => undefined)
    },
    queries: {
      listSaved: (connectionId: number, databaseName: string) => invokeDevice<SavedQuery[]>('queries:list-saved', [connectionId, databaseName]),
      save: (input: SaveQueryInput) => action('queries:save', [input]),
      deleteSaved: (id: number, connectionId: number, databaseName: string) => action('queries:delete-saved', [id, connectionId, databaseName]),
      execute: (connectionId: number, databaseName: string, sql: string, sessionId?: string) =>
        invokeDevice<QueryExecutionResult>('queries:execute', [connectionId, databaseName, sql, sessionId]),
      fetchMore: (connectionId: number, databaseName: string, cursorId: string) =>
        invokeDevice<{ success: boolean; message: string; rows?: Array<Record<string, unknown>>; done?: boolean; offset?: number; totalRows?: number }>('queries:fetch-more', [connectionId, databaseName, cursorId]),
      beginTransaction: (connectionId: number, databaseName: string, sessionId: string) => action('queries:transaction-begin', [connectionId, databaseName, sessionId]),
      commitTransaction: (sessionId: string) => action('queries:transaction-commit', [sessionId]),
      rollbackTransaction: (sessionId: string) => action('queries:transaction-rollback', [sessionId]),
      updateRow: (input: QueryUpdateRowInput) => action('queries:update-row', [input])
    },
    tables: {
      create: (input: CreateTableInput) => action('tables:create', [input]),
      previewImport: (connectionId: number, databaseName: string, tableName: string, filePath?: string) =>
        invokeDevice<import('@/shared/connections').PreviewImportResult>('tables:preview-import', [connectionId, databaseName, tableName, filePath]),
      executeImport: (input: import('@/shared/connections').ExecuteImportInput) =>
        action('tables:execute-import', [input]),
      exportCustomData: (input: import('@/shared/connections').ExportTableCustomInput) =>
        action('tables:export-custom-data', [input]),
      importData: (connectionId: number, databaseName: string, tableName: string) => action('tables:import-data', [connectionId, databaseName, tableName]),
      importCsv: (connectionId: number, databaseName: string, tableName: string) => action('tables:import-csv', [connectionId, databaseName, tableName]),
      exportCsv: (connectionId: number, databaseName: string, tableName: string) => action('tables:export-csv', [connectionId, databaseName, tableName]),
      delete: (connectionId: number, databaseName: string, tableName: string) => action('tables:delete', [connectionId, databaseName, tableName]),
      truncate: (connectionId: number, databaseName: string, tableName: string) => action('tables:truncate', [connectionId, databaseName, tableName]),
      copy: (input: CopyTableInput) => action('tables:copy', [input]),
      transferData: (input: TransferTableDataInput) => action('tables:transfer-data', [input]),
      readData: (connectionId: number, databaseName: string, tableName: string, limit: number, offset: number, filter?: TableDataFilter) =>
        invokeDevice<QueryExecutionResult>('tables:read-data', [connectionId, databaseName, tableName, limit, offset, filter]),
      updateRow: (input: QueryUpdateRowInput) => action('queries:update-row', [input]),
      deleteRow: (input: QueryDeleteRowInput) => action('tables:delete-row', [input]),
      getDefinition: (connectionId: number, databaseName: string, tableName: string) =>
        invokeDevice<TableDefinitionResult>('tables:get-definition', [connectionId, databaseName, tableName]),
      update: (input: UpdateTableInput) => action('tables:update', [input]),
      rename: (input: RenameTableInput) => action('tables:rename', [input])
    },
    ssh: {
      connect: (options) => invokeDevice<{ success: boolean; message: string }>('ssh:connect', [options]),
      write: (sessionId: string, data: string) => invokeDevice<void>('ssh:write', [sessionId, data]),
      resize: (sessionId: string, rows: number, cols: number) => invokeDevice<void>('ssh:resize', [sessionId, rows, cols]),
      disconnect: (sessionId: string) => invokeDevice<void>('ssh:disconnect', [sessionId]),
      listFiles: (sessionId: string, remotePath: string) => invokeDevice('ssh:files:list', [sessionId, remotePath]),
      uploadFiles: (sessionId: string, remoteDirectory: string) => invokeDevice('ssh:files:upload', [sessionId, remoteDirectory]),
      downloadFile: (sessionId: string, entry) => invokeDevice('ssh:files:download', [sessionId, entry]),
      openFile: (sessionId: string, entry) => invokeDevice('ssh:files:open', [sessionId, entry]),
      deleteFile: (sessionId: string, entry) => invokeDevice('ssh:files:delete', [sessionId, entry]),
      onOutput: () => () => undefined,
      onClosed: () => () => undefined
    }
  }
}

export function isHarmonyPlatform(): boolean {
  const harmonyBuild = typeof __QUILLDB_HARMONY__ !== 'undefined' && __QUILLDB_HARMONY__
  return harmonyBuild || Boolean(window.orbisqlHarmony) || /HarmonyOS|OpenHarmony|ArkWeb/i.test(navigator.userAgent)
}

export function installPlatformBridge(): void {
  if (window.omnidb) return
  if (isHarmonyPlatform()) window.omnidb = createHarmonyApi()
}
