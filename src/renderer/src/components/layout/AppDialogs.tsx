// ── 弹窗 / 对话框 ─────────────────────────────────────────
import ConnectionDialog from '../ConnectionDialog'
import ConnectionGroupDialog from '../ConnectionGroupDialog'
import DatabaseDialog from '../DatabaseDialog'
import RenameTableDialog from '../RenameTableDialog'
import SettingsDialog from '../SettingsDialog'
import TableInfoDialog from '../TableInfoDialog'
import TablePickerDialog from '../TablePickerDialog'
import CopyTableDialog from '../CopyTableDialog'
import AboutDialog from '../AboutDialog'
import ProcessListDialog from '../ProcessListDialog'

// ── 模态框 / 预览 ─────────────────────────────────────────
import UnsavedChangesModal from '../UnsavedChangesModal'
import ImportPreviewModal from '../ImportPreviewModal'
import ExportDataPreviewModal from '../ExportDataPreviewModal'
import ExportSqlPreviewModal from '../ExportSqlPreviewModal'
import ExportConfigDialog from '../ExportConfigDialog'
import ImportConfigDialog from '../ImportConfigDialog'
import RunSqlFileModal from '../RunSqlFileModal'

// ── 高级工具 ─────────────────────────────────────────────
import DatabaseAdvancedTools from '../DatabaseAdvancedTools'

// ── 状态管理 ─────────────────────────────────────────────
import { useConnectionStore } from '../../stores/useConnectionStore'
import { useDialogStore } from '../../stores/useDialogStore'
import { useUIStore } from '../../stores/useUIStore'
import { useTableDesignerTabsStore } from '../../stores/tabs/useTableDesignerTabs'
import { useTabStore } from '../../stores/useTabStore'
import type { useTableOperations } from '../../hooks/useTableOperations'

/**
 * 全局对话框装配：连接/数据库/表/设置/导入导出等弹窗统一在此渲染，
 * 让 App 只负责布局组合。对话框状态来自 dialog store，操作结果经 tableOps 回写。
 */
export function AppDialogs({
  tableOps
}: {
  tableOps: ReturnType<typeof useTableOperations>
}) {
  const showConnectionDialog = useDialogStore((s) => s.showConnectionDialog)
  const editingConnection = useDialogStore((s) => s.editingConnection)
  const showConnectionGroupDialog = useDialogStore((s) => s.showConnectionGroupDialog)
  const showSettingsDialog = useDialogStore((s) => s.showSettingsDialog)
  const showAboutDialog = useDialogStore((s) => s.showAboutDialog)
  const databaseDialog = useDialogStore((s) => s.databaseDialog)
  const advancedTool = useDialogStore((s) => s.advancedTool)
  const tablePicker = useDialogStore((s) => s.tablePicker)
  const renameTableDialog = useDialogStore((s) => s.renameTableDialog)
  const renameTableName = useDialogStore((s) => s.renameTableName)
  const renamingTable = useDialogStore((s) => s.renamingTable)
  const renameTableError = useDialogStore((s) => s.renameTableError)
  const tableInfoDialog = useDialogStore((s) => s.tableInfoDialog)
  const importPreviewData = useDialogStore((s) => s.importPreviewData)
  const exportDataDialog = useDialogStore((s) => s.exportDataDialog)
  const runSqlFilePreviewData = useDialogStore((s) => s.runSqlFilePreviewData)
  const exportSqlPreviewDialog = useDialogStore((s) => s.exportSqlPreviewDialog)
  const copyTableDialog = useDialogStore((s) => s.copyTableDialog)
  const processListDialog = useDialogStore((s) => s.processListDialog)
  const showExportConfigDialog = useDialogStore((s) => s.showExportConfigDialog)
  const showImportConfigDialog = useDialogStore((s) => s.showImportConfigDialog)
  const importConfigPreviewData = useDialogStore((s) => s.importConfigPreviewData)
  const dialogActions = useDialogStore((s) => s.actions)

  const language = useUIStore((s) => s.language)
  const theme = useUIStore((s) => s.theme)
  const uiActions = useUIStore((s) => s.actions)

  const connActions = useConnectionStore((s) => s.actions)
  const connections = useConnectionStore((s) => s.connections)

  const pendingCloseTab = useTableDesignerTabsStore((s) => s.pendingCloseTab)
  const forceCloseTableDesigner = useTableDesignerTabsStore((s) => s.forceCloseTableDesigner)
  const setPendingCloseTab = useTableDesignerTabsStore((s) => s.setPendingCloseTab)
  const renameTableInTabs = useTabStore((s) => s.renameTableInTabs)

  return (
    <>
      {showConnectionDialog && (
        <ConnectionDialog
          editingConnection={editingConnection}
          onClose={() => {
            dialogActions.setShowConnectionDialog(false)
            dialogActions.setEditingConnection(null)
          }}
          onSaved={() => void tableOps.handleConnectionSaved()}
        />
      )}
      {showConnectionGroupDialog && (
        <ConnectionGroupDialog
          onClose={() => dialogActions.setShowConnectionGroupDialog(false)}
          onCreated={() => {
            dialogActions.setShowConnectionGroupDialog(false)
            connActions.setGroupsRefreshRequest((prev) => prev + 1)
            void connActions.loadConnections()
          }}
        />
      )}
      {advancedTool && (
        <DatabaseAdvancedTools
          connections={connections}
          initialMode={advancedTool.mode}
          initialRoutineSql={advancedTool.routineSql}
          onClose={() => dialogActions.setAdvancedTool(null)}
        />
      )}
      {databaseDialog && (
        <DatabaseDialog
          connection={databaseDialog.connection}
          database={databaseDialog.database}
          onClose={() => dialogActions.setDatabaseDialog(null)}
          onSaved={() => void tableOps.handleDatabaseSaved()}
        />
      )}
      {tablePicker && (
        <TablePickerDialog
          database={tablePicker.database}
          mode={tablePicker.mode}
          onClose={() => dialogActions.setTablePicker(null)}
          onConfirm={(table) => {
            const picker = tablePicker
            dialogActions.setTablePicker(null)
            if (picker.mode === 'import')
              void tableOps.handleImportTable(picker.connection, picker.database, table)
            else void tableOps.handleExportTable(picker.connection, picker.database, table)
          }}
        />
      )}
      {renameTableDialog && (
        <RenameTableDialog
          databaseName={renameTableDialog.database.name}
          currentName={renameTableDialog.table.name}
          name={renameTableName}
          saving={renamingTable}
          error={renameTableError}
          onNameChange={(name) => {
            dialogActions.setRenameTableName(name)
            dialogActions.setRenameTableError('')
          }}
          onCancel={() => {
            if (renamingTable) return
            dialogActions.setRenameTableDialog(null)
            dialogActions.setRenameTableError('')
          }}
          onSave={() => void tableOps.handleRenameTable(renameTableInTabs)}
        />
      )}
      {tableInfoDialog && (
        <TableInfoDialog
          connection={tableInfoDialog.connection}
          database={tableInfoDialog.database}
          table={tableInfoDialog.table}
          onClose={() => dialogActions.setTableInfoDialog(null)}
        />
      )}
      {showSettingsDialog && (
        <SettingsDialog
          language={language}
          theme={theme}
          onLanguageChange={uiActions.setLanguage}
          onThemeChange={uiActions.setTheme}
          onClose={() => dialogActions.setShowSettingsDialog(false)}
        />
      )}
      {showAboutDialog && (
        <AboutDialog onClose={() => dialogActions.setShowAboutDialog(false)} />
      )}
      {pendingCloseTab && (
        <UnsavedChangesModal
          tableName={pendingCloseTab.tableName}
          onSave={async () => {
            const saveFn = useTableDesignerTabsStore.getState().saveHandlers.get(pendingCloseTab.id)
            if (saveFn) {
              const ok = await saveFn()
              if (ok) {
                forceCloseTableDesigner(pendingCloseTab.id)
              } else {
                setPendingCloseTab(null)
                useTabStore.getState().activateWorkspaceTab({ id: pendingCloseTab.id, kind: 'tables' })
              }
            } else {
              forceCloseTableDesigner(pendingCloseTab.id)
            }
          }}
          onDiscard={() => {
            forceCloseTableDesigner(pendingCloseTab.id)
          }}
          onCancel={() => {
            setPendingCloseTab(null)
          }}
        />
      )}
      {importPreviewData && (
        <ImportPreviewModal
          data={importPreviewData}
          onClose={() => dialogActions.setImportPreviewData(null)}
          onSuccess={() => void connActions.loadConnections()}
        />
      )}
      {exportDataDialog && (
        <ExportDataPreviewModal
          connection={exportDataDialog.connection}
          database={exportDataDialog.database}
          table={exportDataDialog.table}
          onClose={() => dialogActions.setExportDataDialog(null)}
        />
      )}
      {runSqlFilePreviewData && (
        <RunSqlFileModal
          data={runSqlFilePreviewData}
          onClose={() => dialogActions.setRunSqlFilePreviewData(null)}
          onSuccess={() => void connActions.loadConnections()}
        />
      )}
      {exportSqlPreviewDialog && (
        <ExportSqlPreviewModal
          connection={exportSqlPreviewDialog.connection}
          database={exportSqlPreviewDialog.database}
          table={exportSqlPreviewDialog.table}
          initialIncludeData={exportSqlPreviewDialog.includeData}
          onClose={() => dialogActions.setExportSqlPreviewDialog(null)}
          onConfirmExport={(includeData) => {
            void connActions.exportDatabaseSql(
              exportSqlPreviewDialog.connection,
              exportSqlPreviewDialog.database,
              exportSqlPreviewDialog.table?.name,
              includeData
            )
          }}
        />
      )}
      {copyTableDialog && (
        <CopyTableDialog
          connection={copyTableDialog.connection}
          database={copyTableDialog.database}
          table={copyTableDialog.table}
          includeData={copyTableDialog.includeData}
          onClose={() => dialogActions.setCopyTableDialog(null)}
        />
      )}
      {processListDialog && (
        <ProcessListDialog
          connection={processListDialog.connection}
          onClose={() => dialogActions.setProcessListDialog(null)}
        />
      )}
      {showExportConfigDialog && (
        <ExportConfigDialog
          onClose={() => dialogActions.setShowExportConfigDialog(false)}
        />
      )}
      {showImportConfigDialog && (
        <ImportConfigDialog
          onClose={() => dialogActions.setShowImportConfigDialog(false)}
        />
      )}
      {importConfigPreviewData && (
        <ImportConfigDialog
          initialFilePath={importConfigPreviewData.filePath}
          initialGroups={importConfigPreviewData.groups}
          initialConnections={importConfigPreviewData.connections}
          onClose={() => dialogActions.setImportConfigPreviewData(null)}
        />
      )}
      {tableOps.confirmDialog}
    </>
  )
}

export default AppDialogs
