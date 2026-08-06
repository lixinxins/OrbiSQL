// ── 布局组件 ──────────────────────────────────────────────
import HeaderToolbar from './components/layout/HeaderToolbar'
import WorkspaceTabBar from './components/layout/WorkspaceTabBar'
import WorkbenchWelcomeView from './components/layout/WorkbenchWelcomeView'
import TabContextMenuModal from './components/layout/TabContextMenuModal'
import StatusBar from './components/layout/StatusBar'
import AppDialogs from './components/layout/AppDialogs'

// ── 侧栏 ─────────────────────────────────────────────────
import ConnectionSidebar from './components/ConnectionSidebar'

// ── 工作区组件 ────────────────────────────────────────────
import QueryWorkspace from './components/query/QueryWorkspace'
import TableDataWorkspace from './components/TableDataWorkspace'
import DatabaseTablesWorkspace from './components/DatabaseTablesWorkspace'
import TableDialog from './components/TableDialog'
import SshTerminalWorkspace from './components/SshTerminalWorkspace'
import AiDatabaseWorkspace from './components/AiDatabaseWorkspace'
import MarkdownWorkspace from './components/doc/MarkdownWorkspace'

// ── Toast 通知系统 ─────────────────────────────────────────
import { useToastState, ToastProvider, ToastContainer } from './contexts/ToastContext'

// ── 状态管理 (Zustand Store) ──────────────────────────────
import { useConnectionStore } from './stores/useConnectionStore'
import {
  useTabStore,
  useDatabaseTabsStore,
  useTableDesignerTabsStore,
  useQueryTabsStore,
  useTableDataTabsStore,
  useTerminalTabsStore,
  useDocTabsStore,
  useUIStore
} from './stores'
import { useDialogStore } from './stores/useDialogStore'

// ── 自定义 Hook ──────────────────────────────────────────
import { useTableOperations } from './hooks/useTableOperations'
import { useAppMenuEvents } from './hooks/useAppMenuEvents'
import { useStatusBarInfo } from './hooks/useStatusBarInfo'
import { useInterfacePreferences } from './hooks/useInterfacePreferences'
import { useWorkspaceTabCapacity } from './hooks/useWorkspaceTabCapacity'
import { useTabContextMenu } from './hooks/useTabContextMenu'
import { useWorkspaceActions } from './hooks/useWorkspaceActions'

function App() {
  const isMacOS = navigator.userAgent.includes('Macintosh')

  // ── Stores ────────────────────────────────────────────────
  const connections = useConnectionStore((s) => s.connections)

  const databaseTabs = useDatabaseTabsStore((s) => s.databaseTabs)
  const activeDatabaseTabId = useDatabaseTabsStore((s) => s.activeDatabaseTabId)
  const closeDatabaseOverview = useDatabaseTabsStore((s) => s.closeDatabaseOverview)
  const tableDialogs = useTableDesignerTabsStore((s) => s.tableDialogs)
  const activeTableDialogId = useTableDesignerTabsStore((s) => s.activeTableDialogId)
  const designTable = useTableDesignerTabsStore((s) => s.designTable)
  const openTableDesigner = useTableDesignerTabsStore((s) => s.openTableDesigner)
  const closeTableDesigner = useTableDesignerTabsStore((s) => s.closeTableDesigner)
  const queryTabs = useQueryTabsStore((s) => s.queryTabs)
  const activeQueryId = useQueryTabsStore((s) => s.activeQueryId)
  const closeQuery = useQueryTabsStore((s) => s.closeQuery)
  const tableDataTabs = useTableDataTabsStore((s) => s.tableDataTabs)
  const activeTableDataId = useTableDataTabsStore((s) => s.activeTableDataId)
  const openTableData = useTableDataTabsStore((s) => s.openTableData)
  const closeTableData = useTableDataTabsStore((s) => s.closeTableData)
  const sshTerminalTabs = useTerminalTabsStore((s) => s.sshTerminalTabs)
  const activeSshTerminalId = useTerminalTabsStore((s) => s.activeSshTerminalId)
  const closeSshTerminal = useTerminalTabsStore((s) => s.closeSshTerminal)
  const docTabs = useDocTabsStore((s) => s.docTabs)
  const activeDocId = useDocTabsStore((s) => s.activeDocId)
  const closeDocTab = useDocTabsStore((s) => s.closeDocTab)
  const activeWorkspace = useTabStore((s) => s.activeWorkspace)
  const aiDatabaseOpen = useTabStore((s) => s.aiDatabaseOpen)
  const pinnedTabIds = useTabStore((s) => s.pinnedTabIds)
  const activateWorkspaceTab = useTabStore((s) => s.activateWorkspaceTab)
  const closeWithFallback = useTabStore((s) => s.closeWithFallback)
  const togglePinTab = useTabStore((s) => s.togglePinTab)
  const openAiDatabase = useTabStore((s) => s.openAiDatabase)

  const recentConnections = useUIStore((s) => s.recentConnections)
  const tabContextMenu = useUIStore((s) => s.tabContextMenu)
  const dialogActions = useDialogStore((s) => s.actions)

  // ── Custom Hooks ──────────────────────────────────────────
  const tableOps = useTableOperations()
  useAppMenuEvents()
  useStatusBarInfo()
  useInterfacePreferences()
  const { showTabOverflow, setShowTabOverflow, maxVisibleWorkspaceTabs, workspaceTabbarRef } = useWorkspaceTabCapacity()
  const { contextMenuTabs, contextMenuTabIndex, openTabContextMenu, runTabContextAction } = useTabContextMenu()
  const { handleOpenNewConnectionDialog, openQuery, openQueryWithSql, openDefaultQuery, updateQueryDatabase } = useWorkspaceActions()

  const { toasts, showToast, dismissToast } = useToastState()

  // ── Render ────────────────────────────────────────────────

  return (
    <ToastProvider showToast={showToast}>
    <div className={`app${isMacOS ? ' platform-macos' : ''}`}>
      <HeaderToolbar
        onOpenNewConnectionDialog={handleOpenNewConnectionDialog}
        onOpenAiDatabase={openAiDatabase}
        onOpenNewConnectionGroupDialog={() => dialogActions.setShowConnectionGroupDialog(true)}
        onOpenDefaultQuery={openDefaultQuery}
        onOpenAdvancedTool={(mode) => dialogActions.setAdvancedTool({ mode })}
        onOpenSettingsDialog={() => dialogActions.setShowSettingsDialog(true)}
        onExportConnections={() => {
          dialogActions.setShowExportConfigDialog(true)
        }}
        onImportConnections={() => {
          dialogActions.setShowImportConfigDialog(true)
        }}
      />

      <div className="content">
        <ConnectionSidebar />

        <main  className="content-area  table-designer-workspace query-workspace-shell">
           <WorkspaceTabBar
             activeWorkspace={activeWorkspace}
             activateWorkspaceTab={activateWorkspaceTab}
             databaseTabs={databaseTabs}
             activeDatabaseTabId={activeDatabaseTabId}
             closeDatabaseOverview={closeDatabaseOverview}
             tableDialogs={tableDialogs}
             activeTableDialogId={activeTableDialogId}
             closeTableDesigner={closeTableDesigner}
             queryTabs={queryTabs}
             activeQueryId={activeQueryId}
             closeQuery={closeQuery}
             tableDataTabs={tableDataTabs}
             activeTableDataId={activeTableDataId}
             closeTableData={closeTableData}
             sshTerminalTabs={sshTerminalTabs}
             activeSshTerminalId={activeSshTerminalId}
             closeSshTerminal={closeSshTerminal}
             docTabs={docTabs}
             activeDocId={activeDocId}
             closeDocTab={closeDocTab}
             aiDatabaseOpen={aiDatabaseOpen}
             pinnedTabIds={pinnedTabIds}
             togglePinTab={togglePinTab}
             closeWithFallback={closeWithFallback}
             openTabContextMenu={openTabContextMenu}
             maxVisibleWorkspaceTabs={maxVisibleWorkspaceTabs}
             showTabOverflow={showTabOverflow}
             setShowTabOverflow={setShowTabOverflow}
             workspaceTabbarRef={workspaceTabbarRef}
           />

          {activeWorkspace === null && (
            <WorkbenchWelcomeView
              connections={connections}
              recentConnections={recentConnections}
              onOpenNewConnectionDialog={handleOpenNewConnectionDialog}
              onOpenDefaultQuery={openDefaultQuery}
              onOpenAdvancedTool={(mode) => dialogActions.setAdvancedTool({ mode })}
              onOpenQueryForRecent={openQuery}
            />
          )}
          {databaseTabs.map((tab) => {
            const connection = connections.find((item) => item.id === tab.connectionId)
            const database = connection?.databases.find(
              (item) => item.name === tab.databaseName
            )
            return connection && database ? (
              <DatabaseTablesWorkspace
                key={tab.id}
                active={activeWorkspace === 'database' && activeDatabaseTabId === tab.id}
                connection={connection}
                database={database}
                onOpenTable={(conn, db, tbl) => openTableData(conn, db, tbl)}
                onDesignTable={(conn, db, tbl) => designTable(conn, db, tbl)}
                onCreateTable={(conn, db) => openTableDesigner(conn, db)}
                onRenameTable={dialogActions.openRenameTableDialog}
                onDeleteTable={(conn, db, tbl) => void tableOps.handleDeleteTable(conn, db, tbl)}
                onTruncateTable={(conn, db, tbl) => void tableOps.handleTruncateTable(conn, db, tbl)}
                onCopyTable={(conn, db, tbl, inc) => void tableOps.handleCopyTable(conn, db, tbl, inc)}
                onSelectImportTable={(c, d) => dialogActions.openTablePicker(c, d, 'import')}
                onSelectExportTable={(c, d) => dialogActions.openTablePicker(c, d, 'export')}
                onGenerateSql={tableOps.handleGenerateSql}
                onMaintainTable={tableOps.handleMaintainTable}
                onShowTableInfo={(conn, db, tbl) =>
                  void tableOps.handleShowTableInfo(conn, db, tbl)
                }
                onCopySqlStatement={(conn, db, tbl, type) =>
                  void tableOps.handleCopySqlStatement(conn, db, tbl, type)
                }
                onExportDataDictionary={tableOps.handleExportDataDictionary}
              />
            ) : null
          })}
          {tableDialogs.map((tab) => (
            <TableDialog
              key={tab.id}
              id={tab.id}
              active={activeWorkspace === 'tables' && activeTableDialogId === tab.id}
              connection={tab.connection}
              database={tab.database}
              table={tab.table}
              onSaved={(tableName) => void tableOps.handleTableSaved(tab.id, tableName)}
            />
          ))}
          {queryTabs.map((tab) => (
            <QueryWorkspace
              key={tab.id}
              sessionId={tab.id}
              active={activeWorkspace === 'queries' && activeQueryId === tab.id}
              connections={connections}
              context={tab.context}
              onDatabaseChange={(connectionId, databaseName) =>
                updateQueryDatabase(tab.id, connectionId, databaseName)
              }
            />
          ))}
          {tableDataTabs.map((tab) => (
            <TableDataWorkspace
              key={tab.id}
              active={activeWorkspace === 'data' && activeTableDataId === tab.id}
              connection={tab.connection}
              database={tab.database}
              table={tab.table}
              onDesignTable={(conn, db, tbl) => designTable(conn, db, tbl)}
            />
          ))}
          {sshTerminalTabs.map((tab) => (
            <SshTerminalWorkspace
              key={tab.id}
              sessionId={tab.id}
              active={activeWorkspace === 'terminal' && activeSshTerminalId === tab.id}
              connection={tab.connection}
              onClose={() => closeSshTerminal(tab.id)}
            />
          ))}
          {docTabs.map((tab) => (
            <MarkdownWorkspace
              key={tab.id}
              tab={tab}
              active={activeWorkspace === 'doc' && activeDocId === tab.id}
            />
          ))}
          {aiDatabaseOpen && (
            <AiDatabaseWorkspace
              active={activeWorkspace === 'ai'}
              connections={connections}
              onOpenQueryTab={openQueryWithSql}
            />
          )}
          <StatusBar />
        </main>
      </div>
      <TabContextMenuModal
        tabContextMenu={tabContextMenu}
        contextMenuTabs={contextMenuTabs}
        contextMenuTabIndex={contextMenuTabIndex}
        onRunTabContextAction={runTabContextAction}
      />
      <AppDialogs tableOps={tableOps} />
      <ToastContainer toasts={toasts} dismiss={dismissToast} />
    </div>
    </ToastProvider>
  )
}

export default App
