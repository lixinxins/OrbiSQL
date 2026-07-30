/**
 * 共享 IPC Channel 常量 —— preload 与 main 之间的唯一 channel 名来源。
 * 静态 channel 使用 `IpcChannel.xxx`；动态 channel（含 sessionId）使用函数。
 */
export const IpcChannel = {
  app: {
    getInfo: 'app:get-info',
    openSettings: 'app:open-settings',
    openAbout: 'app:open-about',
    updatePreferences: 'app:update-preferences',
    showItemInFolder: 'app:show-item-in-folder',
    openPath: 'app:open-path'
  },
  ai: {
    listModelPresets: 'ai:list-model-presets',
    listModels: 'ai:list-models',
    saveModel: 'ai:save-model',
    deleteModel: 'ai:delete-model',
    chat: 'ai:chat',
    executeProposal: 'ai:execute-proposal'
  },
  connections: {
    list: 'connections:list',
    getOne: 'connections:get-one',
    listGroups: 'connections:list-groups',
    createGroup: 'connections:create-group',
    deleteGroup: 'connections:delete-group',
    renameGroup: 'connections:rename-group',
    setGroup: 'connections:set-group',
    selectSqliteFile: 'connections:select-sqlite-file',
    selectSecurityFile: 'connections:select-security-file',
    create: 'connections:create',
    update: 'connections:update',
    updateColor: 'connections:update-color',
    updateEnvironment: 'connections:update-environment',
    test: 'connections:test',
    testUpdate: 'connections:test-update',
    open: 'connections:open',
    close: 'connections:close',
    duplicate: 'connections:duplicate',
    delete: 'connections:delete',
    readDatabaseDetail: 'connections:read-database-detail',
    runSqlFile: 'connections:run-sql-file',
    previewSqlFile: 'connections:preview-sql-file',
    executeSqlFile: 'connections:execute-sql-file',
    openCreateDialog: 'connections:open-create-dialog',
    getProcessList: 'connections:get-process-list',
    killProcess: 'connections:kill-process',
    exportConfig: 'connections:export-config',
    readImportConfigFile: 'connections:read-import-config-file',
    importConfig: 'connections:import-config',
    updateSortOrders: 'connections:update-sort-orders'
  },
  databases: {
    listCharsets: 'databases:list-charsets',
    create: 'databases:create',
    update: 'databases:update',
    exportSql: 'databases:export-sql',
    previewExportSql: 'databases:preview-export-sql',
    delete: 'databases:delete',
    exportSqlProgress: 'databases:export-sql-progress'
  },
  queries: {
    listSaved: 'queries:list-saved',
    save: 'queries:save',
    deleteSaved: 'queries:delete-saved',
    execute: 'queries:execute',
    fetchMore: 'queries:fetch-more',
    transactionBegin: 'queries:transaction-begin',
    transactionCommit: 'queries:transaction-commit',
    transactionRollback: 'queries:transaction-rollback',
    updateRow: 'queries:update-row'
  },
  tables: {
    create: 'tables:create',
    importData: 'tables:import-data',
    previewImport: 'tables:preview-import',
    executeImport: 'tables:execute-import',
    importCsv: 'tables:import-csv',
    exportCsv: 'tables:export-csv',
    exportCustomData: 'tables:export-custom-data',
    delete: 'tables:delete',
    truncate: 'tables:truncate',
    copy: 'tables:copy',
    transferData: 'tables:transfer-data',
    readData: 'tables:read-data',
    updateRow: 'tables:update-row',
    deleteRow: 'tables:delete-row',
    getDefinition: 'tables:get-definition',
    update: 'tables:update',
    rename: 'tables:rename'
  },
  memory: {
    getStats: 'memory:get-stats',
    takeHeapSnapshot: 'memory:take-heap-snapshot',
    forceGc: 'memory:force-gc'
  },
  workspace: {
    getStats: 'workspace:get-stats'
  },
  ssh: {
    connect: 'ssh:connect',
    write: 'ssh:write',
    resize: 'ssh:resize',
    disconnect: 'ssh:disconnect',
    filesList: 'ssh:files:list',
    filesUpload: 'ssh:files:upload',
    filesDownload: 'ssh:files:download',
    filesOpen: 'ssh:files:open',
    filesDelete: 'ssh:files:delete',
    /** 动态 channel：`ssh:output:${sessionId}` */
    output: (sessionId: string): string => `ssh:output:${sessionId}`,
    /** 动态 channel：`ssh:closed:${sessionId}` */
    closed: (sessionId: string): string => `ssh:closed:${sessionId}`
  }
} as const
