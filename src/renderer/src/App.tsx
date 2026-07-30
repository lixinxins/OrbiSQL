// ── React 核心 ───────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'               // 生命周期、引用、状态
import type { MouseEvent as ReactMouseEvent } from 'react'         // 鼠标事件类型

// ── 布局组件 ──────────────────────────────────────────────
import HeaderToolbar from './components/layout/HeaderToolbar'             // 顶部工具栏（新建连接、设置、主题等）
import WorkspaceTabBar from './components/layout/WorkspaceTabBar'         // 工作区标签页栏（多标签切换与关闭）
import WorkbenchWelcomeView from './components/layout/WorkbenchWelcomeView' // 欢迎页（无标签页激活时的默认视图）
import TabContextMenuModal from './components/layout/TabContextMenuModal' // 标签页右键菜单（关闭/关闭其他/关闭左侧等）
import StatusBar from './components/layout/StatusBar'                     // 全局底部状态栏（Ping、版本、字符集）

// ── 侧栏 ─────────────────────────────────────────────────
import ConnectionSidebar from './components/ConnectionSidebar'             // 左侧连接管理侧栏（连接树、分组、搜索）

// ── 工作区组件 ────────────────────────────────────────────
import QueryWorkspace from './components/query/QueryWorkspace'             // SQL 查询工作区（编辑器 + 结果面板）
import TableDataWorkspace from './components/TableDataWorkspace'           // 数据表浏览工作区（行数据浏览、编辑、筛选）
import DatabaseTablesWorkspace from './components/DatabaseTablesWorkspace' // 数据库表列表管理（批量操作入口）
import DatabaseAdvancedTools from './components/DatabaseAdvancedTools'     // 数据库高级工具集（性能分析、备份恢复等）
import SshTerminalWorkspace from './components/SshTerminalWorkspace'       // SSH 终端工作区（交互式 Shell）
import AiDatabaseWorkspace from './components/AiDatabaseWorkspace'         // AI 数据库助手工作区
import MarkdownWorkspace from './components/doc/MarkdownWorkspace'         // Markdown 文档查看器

// ── 弹窗 / 对话框 ─────────────────────────────────────────
import ConnectionDialog from './components/ConnectionDialog'               // 新建 / 编辑数据库连接弹窗
import ConnectionGroupDialog from './components/ConnectionGroupDialog'     // 新建 / 编辑连接分组弹窗
import DatabaseDialog from './components/DatabaseDialog'                   // 新建 / 编辑数据库弹窗
import RenameTableDialog from './components/RenameTableDialog'             // 重命名数据表弹窗
import SettingsDialog from './components/SettingsDialog'                   // 应用设置弹窗（语言、主题、AI 模型等）
import TableDialog from './components/TableDialog'                         // 表设计器弹窗（建表、编辑字段/索引/外键）
import TableInfoDialog from './components/TableInfoDialog'                 // 表属性 / DDL 查看弹窗
import TablePickerDialog from './components/TablePickerDialog'             // 表选择器弹窗（导入/导出时选表）
import CopyTableDialog from './components/CopyTableDialog'                 // 复制数据表弹窗
import AboutDialog from './components/AboutDialog'                         // 关于弹窗（版本信息、开源链接）
import ProcessListDialog from './components/ProcessListDialog'             // 活动进程 / 会话管理弹窗

// ── 模态框 / 预览 ─────────────────────────────────────────
import UnsavedChangesModal from './components/UnsavedChangesModal'         // 未保存变更确认弹窗
import ImportPreviewModal from './components/ImportPreviewModal'           // 导入数据预览弹窗
import ExportDataPreviewModal from './components/ExportDataPreviewModal'   // 导出数据预览弹窗
import ExportSqlPreviewModal from './components/ExportSqlPreviewModal'     // SQL 导出预览弹窗
import ExportConfigDialog from './components/ExportConfigDialog'         // 导出连接配置预览弹窗
import ImportConfigDialog from './components/ImportConfigDialog'         // 导入连接配置预览弹窗
import RunSqlFileModal from './components/RunSqlFileModal'                 // 运行 SQL 文件预览弹窗

// ── Toast 通知系统 ─────────────────────────────────────────
import { useToastState, ToastProvider, ToastContainer } from './contexts/ToastContext'

// ── 共享类型 ─────────────────────────────────────────────
import type { DatabaseConnection, DatabaseItem } from '../../shared/connections' // 连接与数据库数据结构
import type { AppTheme } from '../../shared/connections'                         // 应用主题类型

// ── 国际化 ───────────────────────────────────────────────
import { applyInterfaceLanguage, stopInterfaceLanguage } from './i18n/interface-language' // 运行时界面语言切换

// ── 状态管理 (Zustand Store) ──────────────────────────────
import { useConnectionStore } from './stores/useConnectionStore' // 连接数据与操作（增删改查、刷新）
import {
  useTabStore,               // 通用标签页状态（激活标签、关闭逻辑）
  useDatabaseTabsStore,      // 数据库概览标签页
  useTableDesignerTabsStore, // 表设计器标签页
  useQueryTabsStore,         // SQL 查询标签页
  useTableDataTabsStore,     // 数据表浏览标签页
  useTerminalTabsStore,      // SSH 终端标签页
  useDocTabsStore,           // 文档标签页
  useSidebarStore,           // 侧栏状态（展开/折叠、搜索、右键菜单）
  useDialogStore,            // 全局弹窗状态（连接/数据库/表/导出等弹窗开关）
  useUIStore,                // UI 偏好（侧栏折叠、主题、语言、最近连接）
  AI_DATABASE_TAB_ID         // AI 数据库助手固定标签页 ID
} from './stores'
import type { WorkspaceTabReference } from './stores' // 工作区标签页引用类型

// ── 自定义 Hook ──────────────────────────────────────────
import { useTableOperations } from './hooks/useTableOperations' // 表级操作（删除、截断、复制、生成 SQL 等）

function App() {
  const isMacOS = navigator.userAgent.includes('Macintosh')

  // ── Stores ────────────────────────────────────────────────
  const connections = useConnectionStore((s) => s.connections)
  const connActions = useConnectionStore((s) => s.actions)

  const databaseTabs = useDatabaseTabsStore((s) => s.databaseTabs)
  const activeDatabaseTabId = useDatabaseTabsStore((s) => s.activeDatabaseTabId)
  const tableDialogs = useTableDesignerTabsStore((s) => s.tableDialogs)
  const activeTableDialogId = useTableDesignerTabsStore((s) => s.activeTableDialogId)
  const queryTabs = useQueryTabsStore((s) => s.queryTabs)
  const activeQueryId = useQueryTabsStore((s) => s.activeQueryId)
  const tableDataTabs = useTableDataTabsStore((s) => s.tableDataTabs)
  const activeTableDataId = useTableDataTabsStore((s) => s.activeTableDataId)
  const sshTerminalTabs = useTerminalTabsStore((s) => s.sshTerminalTabs)
  const activeSshTerminalId = useTerminalTabsStore((s) => s.activeSshTerminalId)
  const closeSshTerminal = useTerminalTabsStore((s) => s.closeSshTerminal)

  const docTabs = useDocTabsStore((s) => s.docTabs)
  const activeDocId = useDocTabsStore((s) => s.activeDocId)
  const closeDocTab = useDocTabsStore((s) => s.closeDocTab)
  const activeWorkspace = useTabStore((s) => s.activeWorkspace)
  const aiDatabaseOpen = useTabStore((s) => s.aiDatabaseOpen)
  const pinnedTabIds = useTabStore((s) => s.pinnedTabIds)
  const focusedConnectionId = useSidebarStore((s) => s.focusedConnectionId)

  // Slice actions
  const addQueryTab = useQueryTabsStore((s) => s.addQueryTab)
  const openQueryWithSqlAction = useQueryTabsStore((s) => s.openQueryWithSql)
  const closeQuery = useQueryTabsStore((s) => s.closeQuery)
  const updateQueryDatabaseAction = useQueryTabsStore((s) => s.updateQueryDatabase)
  const closeDatabaseOverview = useDatabaseTabsStore((s) => s.closeDatabaseOverview)
  const openTableData = useTableDataTabsStore((s) => s.openTableData)
  const closeTableData = useTableDataTabsStore((s) => s.closeTableData)
  const designTable = useTableDesignerTabsStore((s) => s.designTable)
  const openTableDesigner = useTableDesignerTabsStore((s) => s.openTableDesigner)
  const closeTableDesigner = useTableDesignerTabsStore((s) => s.closeTableDesigner)

  // Coordinator actions
  const activateWorkspaceTab = useTabStore((s) => s.activateWorkspaceTab)
  const closeWithFallback = useTabStore((s) => s.closeWithFallback)
  const togglePinTab = useTabStore((s) => s.togglePinTab)
  const openAiDatabase = useTabStore((s) => s.openAiDatabase)
  const renameTableInTabs = useTabStore((s) => s.renameTableInTabs)

  const pendingCloseTab = useTableDesignerTabsStore((s) => s.pendingCloseTab)
  const forceCloseTableDesigner = useTableDesignerTabsStore((s) => s.forceCloseTableDesigner)
  const setPendingCloseTab = useTableDesignerTabsStore((s) => s.setPendingCloseTab)

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
  const recentConnections = useUIStore((s) => s.recentConnections)
  const tabContextMenu = useUIStore((s) => s.tabContextMenu)
  const uiActions = useUIStore((s) => s.actions)

  // ── Custom Hooks ──────────────────────────────────────────
  const tableOps = useTableOperations()

  // ── Local state ───────────────────────────────────────────
  const [showTabOverflow, setShowTabOverflow] = useState(false)
  const [maxVisibleWorkspaceTabs, setMaxVisibleWorkspaceTabs] = useState(1)
  const workspaceTabbarRef = useRef<HTMLDivElement>(null)

  // ── Side effects ──────────────────────────────────────────
  useEffect(() => {
    void connActions.loadConnections()
    return window.omnidb.connections.onCreateRequested(() => {
      dialogActions.setEditingConnection(null)
      dialogActions.setShowConnectionDialog(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () => window.omnidb.onSettingsRequested(() => dialogActions.setShowSettingsDialog(true)),
    [dialogActions]
  )
  useEffect(
    () => window.omnidb.onAboutRequested(() => dialogActions.setShowAboutDialog(true)),
    [dialogActions]
  )

  useEffect(() => {
    if (!tabContextMenu) return
    const close = (): void => uiActions.setTabContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [tabContextMenu, uiActions])

  useEffect(() => {
    const tabbar = workspaceTabbarRef.current
    if (!tabbar) return
    const updateCapacity = (): void => {
      const totalTabs =
        databaseTabs.length +
        tableDialogs.length +
        queryTabs.length +
        tableDataTabs.length +
        sshTerminalTabs.length +
        (aiDatabaseOpen ? 1 : 0)
      const tabbarWidth = tabbar.getBoundingClientRect().width
      const workbenchWidth = 130
      const overflowButtonWidth = 44
      const readableTabWidth = 180
      const capacityWithoutOverflow = Math.max(1, Math.floor((tabbarWidth - workbenchWidth) / readableTabWidth))
      const reservedOverflowWidth = totalTabs > capacityWithoutOverflow ? overflowButtonWidth : 0
      const nextCapacity = Math.max(
        1,
        Math.floor((tabbarWidth - workbenchWidth - reservedOverflowWidth) / readableTabWidth)
      )
      setMaxVisibleWorkspaceTabs(nextCapacity)
    }
    updateCapacity()
    const observer = new ResizeObserver(updateCapacity)
    observer.observe(tabbar)
    return () => observer.disconnect()
  }, [aiDatabaseOpen, databaseTabs.length, queryTabs.length, tableDataTabs.length, tableDialogs.length, sshTerminalTabs.length])

  useEffect(() => {
    if (!showTabOverflow) return
    const close = (): void => setShowTabOverflow(false)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [showTabOverflow])

  useEffect(() => {
    localStorage.setItem('omnidb.preferences.language', language)
    localStorage.setItem('omnidb.preferences.theme', theme)

    const applyTheme = (currentTheme: AppTheme) => {
      // 兼容旧的 system 偏好；项目默认保持浅色，深色玻璃主题仅在用户主动选择时启用。
      const resolved = currentTheme === 'classic' ? 'classic' : 'light'
      document.documentElement.dataset.theme = resolved
    }

    applyTheme(theme)

    if (theme === 'system') {
      // 兼容旧持久化数据：system 统一回落到浅色。
      applyInterfaceLanguage(language)
      void window.omnidb.updatePreferences({ language, theme })
      return stopInterfaceLanguage
    }

    applyInterfaceLanguage(language)
    void window.omnidb.updatePreferences({ language, theme })
    return stopInterfaceLanguage
  }, [language, theme])

  // Status bar: ping + server version + connection counts
  useEffect(() => {
    // Count all active database connections and SSH sessions
    const dbConnectedCount = connections.filter((c) => c.connected).length
    const sshConnectedCount = sshTerminalTabs.length
    // Preserve focusedItem from current state
    const currentFocusedItem = useUIStore.getState().statusInfo.focusedItem

    const activeTab = (() => {
      if (activeWorkspace === 'database' && activeDatabaseTabId)
        return databaseTabs.find((t) => t.id === activeDatabaseTabId) ?? null
      if (activeWorkspace === 'queries' && activeQueryId) {
        const qt = queryTabs.find((t) => t.id === activeQueryId)
        if (qt?.context.connectionId)
          return { connectionId: qt.context.connectionId, databaseName: qt.context.databaseName }
        return null
      }
      return null
    })()

    // Determine connection ID: prefer active tab, fallback to sidebar focused connection
    const connectionId = activeTab?.connectionId ?? focusedConnectionId
    if (!connectionId) {
      uiActions.setStatusInfo({ ping: null, version: '', charset: 'UTF-8', dbConnectedCount, sshConnectedCount, focusedItem: currentFocusedItem })
      return
    }
    const conn = connections.find((c) => c.id === connectionId)
    if (!conn?.connected) {
      uiActions.setStatusInfo({ ping: null, version: '', charset: 'UTF-8', dbConnectedCount, sshConnectedCount, focusedItem: currentFocusedItem })
      return
    }

    // Use active tab's database for ping query, otherwise use connection's default database
    const databaseName = activeTab?.databaseName ?? conn.defaultDatabase
    if (!databaseName) {
      uiActions.setStatusInfo({ ping: null, version: '', charset: 'UTF-8', dbConnectedCount, sshConnectedCount, focusedItem: currentFocusedItem })
      return
    }

    const start = performance.now()
    void window.omnidb.queries
      .execute(
        connectionId,
        databaseName,
        conn.engine === 'PostgreSQL'
          ? 'SELECT version()'
          : conn.engine === 'SQLite'
            ? 'SELECT sqlite_version()'
            : 'SELECT VERSION()'
      )
      .then((res) => {
        const ping = Math.round(performance.now() - start)
        const raw = res.rows?.[0]
        const versionStr: string = raw ? String(Object.values(raw as Record<string, unknown>)[0] ?? '') : ''
        const short = versionStr.match(/[\d.]+/)?.[0] ?? ''
        uiActions.setStatusInfo({
          ping,
          version: short,
          charset: conn.engine === 'PostgreSQL' ? 'UTF8' : 'utf8mb4',
          dbConnectedCount,
          sshConnectedCount,
          focusedItem: currentFocusedItem
        })
      })
      .catch(() => uiActions.setStatusInfo({ ping: null, version: '', charset: 'UTF-8', dbConnectedCount, sshConnectedCount, focusedItem: currentFocusedItem }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, activeDatabaseTabId, activeQueryId, focusedConnectionId, connections, sshTerminalTabs])

  // ── Helpers ───────────────────────────────────────────────

  const handleOpenNewConnectionDialog = (): void => {
    dialogActions.setEditingConnection(null)
    dialogActions.setShowConnectionDialog(true)
  }

  const openQuery = (
    connection: DatabaseConnection,
    database: DatabaseItem
  ): void => {
    uiActions.pushRecentConnection({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name,
      engine: connection.engine,
      ts: Date.now()
    })
    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name
    })
  }

  const openQueryWithSql = (
    connectionId: number | null,
    databaseName: string,
    sql: string
  ): void => {
    const currentConnections = useConnectionStore.getState().connections
    openQueryWithSqlAction(connectionId, databaseName, sql, currentConnections)
  }

  const getActiveDatabaseContext = (): { connectionId: number; connectionName: string; databaseName: string } | null => {
    if (activeWorkspace === 'database' && activeDatabaseTabId) {
      const tab = databaseTabs.find((t) => t.id === activeDatabaseTabId)
      if (tab) return { connectionId: tab.connectionId, connectionName: tab.connectionName, databaseName: tab.databaseName }
    }
    if (activeWorkspace === 'data' && activeTableDataId) {
      const tab = tableDataTabs.find((t) => t.id === activeTableDataId)
      if (tab) return { connectionId: tab.connection.id, connectionName: tab.connection.name, databaseName: tab.database.name }
    }
    if (activeWorkspace === 'tables' && activeTableDialogId) {
      const tab = tableDialogs.find((t) => t.id === activeTableDialogId)
      if (tab) return { connectionId: tab.connection.id, connectionName: tab.connection.name, databaseName: tab.database.name }
    }
    if (activeWorkspace === 'queries' && activeQueryId) {
      const tab = queryTabs.find((t) => t.id === activeQueryId)
      if (tab?.context.connectionId && tab?.context.databaseName) {
        return {
          connectionId: tab.context.connectionId,
          connectionName: tab.context.connectionName || '',
          databaseName: tab.context.databaseName
        }
      }
    }

    const expandedDatabases = Array.from(useSidebarStore.getState().expandedDatabases) as string[]
    if (expandedDatabases.length > 0) {
      const lastKey = expandedDatabases[expandedDatabases.length - 1]
      const [connIdStr, dbName] = lastKey.split(':')
      const connId = Number(connIdStr)
      if (connIdStr && dbName) {
        const conn = connections.find((c) => c.id === connId)
        if (conn) {
          return { connectionId: conn.id, connectionName: conn.name, databaseName: dbName }
        }
      }
    }

    return null
  }

  const openDefaultQuery = (): void => {
    const activeCtx = getActiveDatabaseContext()
    if (activeCtx) {
      addQueryTab({
        connectionId: activeCtx.connectionId,
        connectionName: activeCtx.connectionName,
        databaseName: activeCtx.databaseName
      })
    } else {
      const openConn =
        connections.find((c) => c.open && c.databases.length > 0) ??
        connections.find((c) => c.connected && c.databases.length > 0) ??
        connections.find((c) => c.databases.length > 0)
      if (openConn && openConn.databases[0]) {
        addQueryTab({
          connectionId: openConn.id,
          connectionName: openConn.name,
          databaseName: openConn.databases[0].name
        })
      } else {
        addQueryTab({ connectionId: null, connectionName: '', databaseName: '' })
      }
    }
  }

  const updateQueryDatabase = (
    id: string,
    connectionId: number | null,
    databaseName: string
  ): void => {
    const currentConnections = useConnectionStore.getState().connections
    updateQueryDatabaseAction(id, connectionId, databaseName, currentConnections)
  }

  // ── Tab context menu operations ───────────────────────────

  const buildWorkspaceTabs = (): WorkspaceTabReference[] => [
    ...databaseTabs.map((tab) => ({ id: tab.id, kind: 'database' as const })),
    ...tableDialogs.map((tab) => ({ id: tab.id, kind: 'tables' as const })),
    ...queryTabs.map((tab) => ({ id: tab.id, kind: 'queries' as const })),
    ...tableDataTabs.map((tab) => ({ id: tab.id, kind: 'data' as const })),
    ...sshTerminalTabs.map((tab) => ({ id: tab.id, kind: 'terminal' as const })),
    ...docTabs.map((tab) => ({ id: tab.id, kind: 'doc' as const })),
    ...(aiDatabaseOpen ? [{ id: AI_DATABASE_TAB_ID, kind: 'ai' as const }] : [])
  ]

  const openTabContextMenu = (event: ReactMouseEvent, tab: WorkspaceTabReference): void => {
    event.preventDefault()
    event.stopPropagation()
    uiActions.setTabContextMenu({
      id: tab.id,
      kind: tab.kind,
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - 154)
    })
  }

  const runTabContextAction = (action: 'current' | 'others' | 'left' | 'right'): void => {
    const ctxMenu = useUIStore.getState().tabContextMenu
    if (!ctxMenu) return
    const allTabs = buildWorkspaceTabs()
    const targetIndex = allTabs.findIndex((tab) => tab.id === ctxMenu.id)
    if (targetIndex < 0) return
    const targetTab = allTabs[targetIndex]
    switch (action) {
      case 'current': {
        switch (targetTab.kind) {
          case 'database': closeDatabaseOverview(targetTab.id); break
          case 'tables': closeTableDesigner(targetTab.id); break
          case 'queries': closeQuery(targetTab.id); break
          case 'data': closeTableData(targetTab.id); break
          case 'terminal': closeSshTerminal(targetTab.id); break
          case 'ai': closeWithFallback('ai', AI_DATABASE_TAB_ID); break
        }
        break
      }
      case 'others': {
        const others = allTabs.filter((_, i) => i !== targetIndex)
        for (const t of others) closeWithFallback(t.kind, t.id)
        break
      }
      case 'left': {
        const leftTabs = allTabs.slice(0, targetIndex)
        for (const t of leftTabs) closeWithFallback(t.kind, t.id)
        break
      }
      case 'right': {
        const rightTabs = allTabs.slice(targetIndex + 1)
        for (const t of rightTabs) closeWithFallback(t.kind, t.id)
        break
      }
    }
    uiActions.setTabContextMenu(null)
  }

  const contextMenuTabs = buildWorkspaceTabs()
  const contextMenuTabIndex = tabContextMenu
    ? contextMenuTabs.findIndex((tab) => tab.id === tabContextMenu.id)
    : -1

  // ── Render ────────────────────────────────────────────────

  const { toasts, showToast, dismissToast } = useToastState()

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
      <ToastContainer toasts={toasts} dismiss={dismissToast} />
    </div>
    </ToastProvider>
  )
}

export default App
