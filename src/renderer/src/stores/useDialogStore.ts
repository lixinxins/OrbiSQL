import { create } from 'zustand'
import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'
import type { AdvancedToolMode } from '../components/DatabaseAdvancedTools'
import type { ExportSqlDialogState } from '../components/ExportSqlDialog'

export interface DialogState {
  showConnectionDialog: boolean
  editingConnection: DatabaseConnection | null
  showConnectionGroupDialog: boolean
  showSettingsDialog: boolean
  showAboutDialog: boolean
  databaseDialog: { connection: DatabaseConnection; database: DatabaseItem | null } | null
  advancedTool: { mode: AdvancedToolMode; routineSql?: string } | null
  tablePicker: { connection: DatabaseConnection; database: DatabaseItem; mode: 'import' | 'export' } | null
  renameTableDialog: { connection: DatabaseConnection; database: DatabaseItem; table: TableItem } | null
  renameTableName: string
  renamingTable: boolean
  renameTableError: string
  tableInfoDialog: { connection: DatabaseConnection; database: DatabaseItem; table: TableItem } | null
  exportSqlDialog: ExportSqlDialogState | null
  importPreviewData: import('@/shared/connections').PreviewImportResult | null
  exportDataDialog: { connection: DatabaseConnection; database: DatabaseItem; table: TableItem } | null
  runSqlFilePreviewData: import('@/shared/connections').PreviewSqlFileResult | null
  exportSqlPreviewDialog: {
    connection: DatabaseConnection
    database: DatabaseItem
    table?: TableItem
    includeData: boolean
  } | null
  copyTableDialog: {
    connection: DatabaseConnection
    database: DatabaseItem
    table: TableItem
    includeData: boolean
  } | null
  processListDialog: { connection: DatabaseConnection } | null
  showExportConfigDialog: boolean
  showImportConfigDialog: boolean
  importConfigPreviewData: {
    filePath: string
    groups: Array<{ name: string; category?: 'database' | 'ssh' }>
    connections: Array<import('@/shared/connections').CreateConnectionInput & { groupName?: string }>
  } | null
  actions: {
    setShowConnectionDialog: (open: boolean) => void
    setEditingConnection: (editingConnection: DatabaseConnection | null) => void
    setShowConnectionGroupDialog: (open: boolean) => void
    setShowSettingsDialog: (open: boolean) => void
    setShowAboutDialog: (open: boolean) => void
    setDatabaseDialog: (databaseDialog: DialogState['databaseDialog']) => void
    setAdvancedTool: (advancedTool: DialogState['advancedTool']) => void
    setTablePicker: (tablePicker: DialogState['tablePicker']) => void
    setRenameTableDialog: (renameTableDialog: DialogState['renameTableDialog']) => void
    setRenameTableName: (name: string) => void
    setRenamingTable: (renamingTable: boolean) => void
    setRenameTableError: (error: string) => void
    setTableInfoDialog: (tableInfoDialog: DialogState['tableInfoDialog']) => void
    setExportSqlDialog: (exportSqlDialog: ExportSqlDialogState | null) => void
    setImportPreviewData: (importPreviewData: import('@/shared/connections').PreviewImportResult | null) => void
    setExportDataDialog: (exportDataDialog: DialogState['exportDataDialog']) => void
    setRunSqlFilePreviewData: (runSqlFilePreviewData: import('@/shared/connections').PreviewSqlFileResult | null) => void
    setExportSqlPreviewDialog: (exportSqlPreviewDialog: DialogState['exportSqlPreviewDialog']) => void
    setCopyTableDialog: (copyTableDialog: DialogState['copyTableDialog']) => void
    setProcessListDialog: (processListDialog: DialogState['processListDialog']) => void
    setShowExportConfigDialog: (open: boolean) => void
    setShowImportConfigDialog: (open: boolean) => void
    setImportConfigPreviewData: (data: DialogState['importConfigPreviewData']) => void
    openRenameTableDialog: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
    openTableInfoDialog: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
    openTablePicker: (connection: DatabaseConnection, database: DatabaseItem, mode: 'import' | 'export') => void
  }
}

export const useDialogStore = create<DialogState>((set) => ({
  showConnectionDialog: false,
  editingConnection: null,
  showConnectionGroupDialog: false,
  showSettingsDialog: false,
  showAboutDialog: false,
  databaseDialog: null,
  advancedTool: null,
  tablePicker: null,
  renameTableDialog: null,
  renameTableName: '',
  renamingTable: false,
  renameTableError: '',
  tableInfoDialog: null,
  exportSqlDialog: null,
  importPreviewData: null,
  exportDataDialog: null,
  runSqlFilePreviewData: null,
  exportSqlPreviewDialog: null,
  copyTableDialog: null,
  processListDialog: null,
  showExportConfigDialog: false,
  showImportConfigDialog: false,
  importConfigPreviewData: null,

  actions: {
    setShowConnectionDialog: (open) => set({ showConnectionDialog: open }),
    setEditingConnection: (editingConnection) => set({ editingConnection }),
    setShowConnectionGroupDialog: (open) => set({ showConnectionGroupDialog: open }),
    setShowSettingsDialog: (open) => set({ showSettingsDialog: open }),
    setShowAboutDialog: (open) => set({ showAboutDialog: open }),
    setDatabaseDialog: (databaseDialog) => set({ databaseDialog }),
    setAdvancedTool: (advancedTool) => set({ advancedTool }),
    setTablePicker: (tablePicker) => set({ tablePicker }),
    setRenameTableDialog: (renameTableDialog) => set({ renameTableDialog }),
    setRenameTableName: (renameTableName) => set({ renameTableName }),
    setRenamingTable: (renamingTable) => set({ renamingTable }),
    setRenameTableError: (renameTableError) => set({ renameTableError }),
    setTableInfoDialog: (tableInfoDialog) => set({ tableInfoDialog }),
    setExportSqlDialog: (exportSqlDialog) => set({ exportSqlDialog }),
    setImportPreviewData: (importPreviewData) => set({ importPreviewData }),
    setExportDataDialog: (exportDataDialog) => set({ exportDataDialog }),
    setRunSqlFilePreviewData: (runSqlFilePreviewData) => set({ runSqlFilePreviewData }),
    setExportSqlPreviewDialog: (exportSqlPreviewDialog) => set({ exportSqlPreviewDialog }),
    setCopyTableDialog: (copyTableDialog) => set({ copyTableDialog }),
    setProcessListDialog: (processListDialog) => set({ processListDialog }),
    setShowExportConfigDialog: (open) => set({ showExportConfigDialog: open }),
    setShowImportConfigDialog: (open) => set({ showImportConfigDialog: open }),
    setImportConfigPreviewData: (data) => set({ importConfigPreviewData: data }),

    openRenameTableDialog: (connection, database, table) => {
      set({ renameTableDialog: { connection, database, table }, renameTableName: table.name, renameTableError: '' })
    },

    openTableInfoDialog: (connection, database, table) => {
      set({ tableInfoDialog: { connection, database, table } })
    },

    openTablePicker: (connection, database, mode) => {
      set({ tablePicker: { connection, database, mode } })
    }
  }
}))
