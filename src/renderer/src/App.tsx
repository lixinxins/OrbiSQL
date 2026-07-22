import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  CaretLeft,
  CaretRight,
  Code,
  Database,
  DotsThree,
  FileSql,
  FolderOpen,
  GearSix,
  Plus,
  PushPin,
  Rows,
  Sparkle,
  GitDiff,
  FlowArrow,
  WifiHigh,
  X
} from '@phosphor-icons/react'
import ConnectionSidebar from './components/ConnectionSidebar'
import AboutDialog from './components/AboutDialog'
import AiDatabaseWorkspace from './components/AiDatabaseWorkspace'
import ConnectionDialog from './components/ConnectionDialog'
import ConnectionGroupDialog from './components/ConnectionGroupDialog'
import { useConfirmDialog } from './components/ConfirmDialog'
import DatabaseDialog from './components/DatabaseDialog'
import DatabaseAdvancedTools from './components/DatabaseAdvancedTools'
import type { AdvancedToolMode } from './components/DatabaseAdvancedTools'
import DatabaseTablesWorkspace from './components/DatabaseTablesWorkspace'
import QueryWorkspace from './components/QueryWorkspace'
import type { QueryContext } from './components/QueryWorkspace'
import RenameTableDialog from './components/RenameTableDialog'
import SettingsDialog from './components/SettingsDialog'
import TableDialog from './components/TableDialog'
import TableDataWorkspace from './components/TableDataWorkspace'
import TableInfoDialog from './components/TableInfoDialog'
import TablePickerDialog from './components/TablePickerDialog'
import type { DatabaseConnection, DatabaseItem, TableItem } from '../../shared/connections'
import type { AppLanguage, AppTheme } from '../../shared/connections'
import { applyInterfaceLanguage, stopInterfaceLanguage } from './i18n/interface-language'
import { isHarmonyPlatform } from './platform/platform-bridge'
import omniDbIcon from '../../../resources/icon.png'

interface TableDesignerTab {
  id: string
  connection: DatabaseConnection
  database: DatabaseItem
  table?: TableItem
}

interface QueryTab {
  id: string
  context: QueryContext
}

interface TableDataTab {
  id: string
  connection: DatabaseConnection
  database: DatabaseItem
  table: TableItem
}

interface DatabaseOverviewTab {
  id: string
  connectionId: number
  connectionName: string
  databaseName: string
}

type WorkspaceKind = 'database' | 'tables' | 'queries' | 'data' | 'ai' | null
type ClosableWorkspaceKind = Exclude<WorkspaceKind, null>
const AI_DATABASE_TAB_ID = 'ai-database-workspace'

interface WorkspaceTabReference {
  id: string
  kind: ClosableWorkspaceKind
}

interface TabContextMenu extends WorkspaceTabReference {
  x: number
  y: number
}

function App() {
  const isMacOS = navigator.userAgent.includes('Macintosh')
  const { confirm, confirmDialog } = useConfirmDialog()
  const [language, setLanguage] = useState<AppLanguage>(() => localStorage.getItem('omnidb.preferences.language') === 'en-US' ? 'en-US' : 'zh-CN')
  const [theme, setTheme] = useState<AppTheme>(() => {
    const saved = localStorage.getItem('omnidb.preferences.theme')
    return (saved === 'system' || saved === 'light' || saved === 'slate' || saved === 'violet' || saved === 'classic') ? (saved as AppTheme) : 'classic'
  })
  const [connections, setConnections] = useState<DatabaseConnection[]>([])
  const [connectionsLoading, setConnectionsLoading] = useState(true)
  const [showConnectionDialog, setShowConnectionDialog] = useState(false)
  const [showConnectionGroupDialog, setShowConnectionGroupDialog] = useState(false)
  const [groupsRefreshRequest, setGroupsRefreshRequest] = useState(0)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showAboutDialog, setShowAboutDialog] = useState(false)
  const [editingConnection, setEditingConnection] = useState<DatabaseConnection | null>(null)
  const [databaseDialog, setDatabaseDialog] = useState<{ connection: DatabaseConnection; database: DatabaseItem | null } | null>(null)
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([])
  const [activeQueryId, setActiveQueryId] = useState<string | null>(null)
  const [activeDatabase, setActiveDatabase] = useState<{ connection: DatabaseConnection; database: DatabaseItem } | null>(null)
  const [tableDialogs, setTableDialogs] = useState<TableDesignerTab[]>([])
  const [activeTableDialogId, setActiveTableDialogId] = useState<string | null>(null)
  const [tableDataTabs, setTableDataTabs] = useState<TableDataTab[]>([])
  const [activeTableDataId, setActiveTableDataId] = useState<string | null>(null)
  const [databaseTabs, setDatabaseTabs] = useState<DatabaseOverviewTab[]>([])
  const [activeDatabaseTabId, setActiveDatabaseTabId] = useState<string | null>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceKind>(null)
  const [aiDatabaseOpen, setAiDatabaseOpen] = useState(false)
  const [advancedTool, setAdvancedTool] = useState<{ mode: AdvancedToolMode; routineSql?: string } | null>(null)
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenu | null>(null)
  const [showTabOverflow, setShowTabOverflow] = useState(false)
  const [maxVisibleWorkspaceTabs, setMaxVisibleWorkspaceTabs] = useState(1)
  const workspaceTabbarRef = useRef<HTMLDivElement>(null)
  const [tablePicker, setTablePicker] = useState<{ connection: DatabaseConnection; database: DatabaseItem; mode: 'import' | 'export' } | null>(null)
  const [tableInfoDialog, setTableInfoDialog] = useState<{ connection: DatabaseConnection; database: DatabaseItem; table: TableItem } | null>(null)
  const [renameTableDialog, setRenameTableDialog] = useState<{ connection: DatabaseConnection; database: DatabaseItem; table: TableItem } | null>(null)
  const [renameTableName, setRenameTableName] = useState('')
  const [renamingTable, setRenamingTable] = useState(false)
  const [renameTableError, setRenameTableError] = useState('')
  const [pinnedTabIds, setPinnedTabIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('orbisql.pinned-tabs.v1') ?? '[]') as string[]) } catch { return new Set() }
  })
  const [statusInfo, setStatusInfo] = useState<{ ping: number | null; version: string; charset: string }>({ ping: null, version: '', charset: 'UTF-8' })
  const [recentConnections, setRecentConnections] = useState<{ connectionId: number; connectionName: string; databaseName: string; engine: string; ts: number }[]>(() => {
    try { return JSON.parse(localStorage.getItem('orbisql.recent-connections.v1') ?? '[]') as { connectionId: number; connectionName: string; databaseName: string; engine: string; ts: number }[] } catch { return [] }
  })

  const loadConnections = useCallback(async (): Promise<DatabaseConnection[]> => {
    setConnectionsLoading(true)
    try {
      const loadedConnections = await window.omnidb.connections.list()
      setConnections(loadedConnections)
      return loadedConnections
    } finally {
      setConnectionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConnections()
    return window.omnidb.connections.onCreateRequested(() => {
      setEditingConnection(null)
      setShowConnectionDialog(true)
    })
  }, [loadConnections])

  useEffect(() => window.omnidb.onSettingsRequested(() => setShowSettingsDialog(true)), [])
  useEffect(() => window.omnidb.onAboutRequested(() => setShowAboutDialog(true)), [])

  useEffect(() => {
    if (!tabContextMenu) return
    const close = (): void => setTabContextMenu(null)
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
  }, [tabContextMenu])

  useEffect(() => {
    const tabbar = workspaceTabbarRef.current
    if (!tabbar) return
    const updateCapacity = (): void => {
      const totalTabs = databaseTabs.length + tableDialogs.length + queryTabs.length + tableDataTabs.length + (aiDatabaseOpen ? 1 : 0)
      const tabbarWidth = tabbar.getBoundingClientRect().width
      const workbenchWidth = 130
      const overflowButtonWidth = 44
      const readableTabWidth = 180
      const capacityWithoutOverflow = Math.max(1, Math.floor((tabbarWidth - workbenchWidth) / readableTabWidth))
      const reservedOverflowWidth = totalTabs > capacityWithoutOverflow ? overflowButtonWidth : 0
      const nextCapacity = Math.max(1, Math.floor((tabbarWidth - workbenchWidth - reservedOverflowWidth) / readableTabWidth))
      setMaxVisibleWorkspaceTabs(nextCapacity)
    }
    updateCapacity()
    const observer = new ResizeObserver(updateCapacity)
    observer.observe(tabbar)
    return () => observer.disconnect()
  }, [aiDatabaseOpen, databaseTabs.length, queryTabs.length, tableDataTabs.length, tableDialogs.length])

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
      if (currentTheme === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        document.documentElement.dataset.theme = isDark ? 'classic' : 'light'
      } else {
        document.documentElement.dataset.theme = currentTheme
      }
    }

    applyTheme(theme)

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        document.documentElement.dataset.theme = e.matches ? 'classic' : 'light'
      }
      mediaQuery.addEventListener('change', handleChange)
      applyInterfaceLanguage(language)
      void window.omnidb.updatePreferences({ language, theme })
      return () => {
        mediaQuery.removeEventListener('change', handleChange)
        stopInterfaceLanguage()
      }
    }

    applyInterfaceLanguage(language)
    void window.omnidb.updatePreferences({ language, theme })
    return stopInterfaceLanguage
  }, [language, theme])

  const openNewConnectionDialog = (): void => {
    setEditingConnection(null)
    setShowConnectionDialog(true)
  }

  // Status bar: ping + server version when active connection changes
  useEffect(() => {
    const activeTab = (() => {
      if (activeWorkspace === 'database' && activeDatabaseTabId) return databaseTabs.find((t) => t.id === activeDatabaseTabId) ?? null
      if (activeWorkspace === 'queries' && activeQueryId) {
        const qt = queryTabs.find((t) => t.id === activeQueryId)
        if (qt?.context.connectionId) return { connectionId: qt.context.connectionId, databaseName: qt.context.databaseName }
        return null
      }
      return null
    })()
    if (!activeTab) { setStatusInfo({ ping: null, version: '', charset: 'UTF-8' }); return }
    const conn = connections.find((c) => c.id === activeTab.connectionId)
    if (!conn?.connected) { setStatusInfo({ ping: null, version: '', charset: 'UTF-8' }); return }
    const start = performance.now()
    void window.omnidb.queries.execute(activeTab.connectionId, activeTab.databaseName,
      conn.engine === 'PostgreSQL' ? 'SELECT version()' : conn.engine === 'SQLite' ? 'SELECT sqlite_version()' : 'SELECT VERSION()'
    ).then((res) => {
      const ping = Math.round(performance.now() - start)
      const raw = res.rows?.[0]
      const versionStr: string = raw ? String(Object.values(raw as Record<string, unknown>)[0] ?? '') : ''
      const short = versionStr.match(/[\d.]+/)?.[0] ?? ''
      setStatusInfo({ ping, version: short, charset: conn.engine === 'PostgreSQL' ? 'UTF8' : 'utf8mb4' })
    }).catch(() => setStatusInfo({ ping: null, version: '', charset: 'UTF-8' }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace, activeDatabaseTabId, activeQueryId])

  const openEditConnectionDialog = (connection: DatabaseConnection): void => {
    setEditingConnection(connection)
    setShowConnectionDialog(true)
  }

  const toggleConnection = async (connection: DatabaseConnection): Promise<boolean> => {
    const result = connection.open
      ? await window.omnidb.connections.close(connection.id)
      : await window.omnidb.connections.open(connection.id)
    if (!result.success) window.alert(result.message)
    if (result.success && connection.open && activeDatabase?.connection.id === connection.id) setActiveDatabase(null)
    await loadConnections()
    return result.success
  }

  const duplicateConnection = async (connection: DatabaseConnection): Promise<void> => {
    const result = await window.omnidb.connections.duplicate(connection.id)
    if (!result.success) window.alert(result.message)
    await loadConnections()
  }

  const deleteConnection = async (connection: DatabaseConnection): Promise<void> => {
    const confirmed = await confirm({
      title: '删除连接',
      message: `确定要删除连接“${connection.name}”吗？`,
      detail: '只会删除 OrbiSQL 中保存的连接信息，不会删除数据库中的任何数据。',
      confirmLabel: '删除连接'
    })
    if (!confirmed) return
    const result = await window.omnidb.connections.delete(connection.id, connection.name)
    if (result.success) await loadConnections()
    else window.alert(result.message)
  }

  const runSqlFile = async (connection: DatabaseConnection): Promise<void> => {
    const result = await window.omnidb.connections.runSqlFile(connection.id)
    if (result.message !== '已取消执行') window.alert(result.message)
    if (result.success) await loadConnections()
  }

  const runDatabaseSqlFile = async (connection: DatabaseConnection, database: DatabaseItem): Promise<void> => {
    const result = await window.omnidb.connections.runSqlFile(connection.id, database.name)
    if (result.message !== '已取消执行') window.alert(result.message)
    if (result.success) await loadConnections()
  }

  const deleteDatabase = async (connection: DatabaseConnection, database: DatabaseItem): Promise<void> => {
    const confirmed = await confirm({
      title: '永久删除数据库',
      message: `确定要删除数据库“${database.name}”吗？`,
      detail: '数据库中的所有表、结构和数据都会被永久删除，此操作无法撤销。',
      confirmLabel: '永久删除'
    })
    if (!confirmed) return
    const result = await window.omnidb.databases.delete(connection.id, database.name)
    if (result.success) {
      if (activeDatabase?.connection.id === connection.id && activeDatabase.database.name === database.name) setActiveDatabase(null)
      await loadConnections()
    } else window.alert(result.message)
  }

  const addQueryTab = (context: QueryContext): void => {
    const id = crypto.randomUUID()
    setQueryTabs((current) => [...current, { id, context }])
    setActiveQueryId(id)
    setActiveWorkspace('queries')
  }

  const openQuery = (connection: DatabaseConnection, database: DatabaseItem): void => {
    const entry = { connectionId: connection.id, connectionName: connection.name, databaseName: database.name, engine: connection.engine, ts: Date.now() }
    setRecentConnections((prev) => { const next = [entry, ...prev.filter((r) => !(r.connectionId === connection.id && r.databaseName === database.name))].slice(0, 8); localStorage.setItem('orbisql.recent-connections.v1', JSON.stringify(next)); return next })
    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name
    })
  }

  const openQueryWithSql = (connectionId: number | null, databaseName: string, sql: string): void => {
    const connection = connections.find((c) => c.id === connectionId)
    const id = crypto.randomUUID()
    setQueryTabs((current) => [...current, { id, context: { connectionId, connectionName: connection?.name ?? '', databaseName, initialSql: sql, autoRun: false } }])
    setActiveQueryId(id)
    setActiveWorkspace('queries')
  }

  const togglePinTab = (tabId: string): void => {
    setPinnedTabIds((prev) => {
      const next = new Set(prev)
      if (next.has(tabId)) next.delete(tabId); else next.add(tabId)
      localStorage.setItem('orbisql.pinned-tabs.v1', JSON.stringify(Array.from(next)))
      return next
    })
  }

  const openDatabaseOverview = (connection: DatabaseConnection, database: DatabaseItem): void => {
    const existingTab = databaseTabs.find((tab) =>
      tab.connectionId === connection.id && tab.databaseName === database.name)
    if (existingTab) {
      setActiveDatabaseTabId(existingTab.id)
      setActiveWorkspace('database')
      return
    }
    const id = crypto.randomUUID()
    setDatabaseTabs((current) => [...current, {
      id,
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name
    }])
    setActiveDatabaseTabId(id)
    setActiveWorkspace('database')
  }

  const closeDatabaseOverview = (id: string): void => {
    const closingIndex = databaseTabs.findIndex((tab) => tab.id === id)
    const remainingTabs = databaseTabs.filter((tab) => tab.id !== id)
    setDatabaseTabs(remainingTabs)
    if (activeDatabaseTabId === id) {
      const nextTab = remainingTabs[Math.min(closingIndex, remainingTabs.length - 1)]
      setActiveDatabaseTabId(nextTab?.id ?? null)
      if (!nextTab && activeWorkspace === 'database') setActiveWorkspace(null)
    }
  }

  const workspaceTabs = (): WorkspaceTabReference[] => [
    ...databaseTabs.map((tab) => ({ id: tab.id, kind: 'database' as const })),
    ...tableDialogs.map((tab) => ({ id: tab.id, kind: 'tables' as const })),
    ...queryTabs.map((tab) => ({ id: tab.id, kind: 'queries' as const })),
    ...tableDataTabs.map((tab) => ({ id: tab.id, kind: 'data' as const })),
    ...(aiDatabaseOpen ? [{ id: AI_DATABASE_TAB_ID, kind: 'ai' as const }] : [])
  ]

  const activeWorkspaceTab = (): WorkspaceTabReference | null => {
    if (activeWorkspace === 'database' && activeDatabaseTabId) return { id: activeDatabaseTabId, kind: 'database' }
    if (activeWorkspace === 'tables' && activeTableDialogId) return { id: activeTableDialogId, kind: 'tables' }
    if (activeWorkspace === 'queries' && activeQueryId) return { id: activeQueryId, kind: 'queries' }
    if (activeWorkspace === 'data' && activeTableDataId) return { id: activeTableDataId, kind: 'data' }
    if (activeWorkspace === 'ai' && aiDatabaseOpen) return { id: AI_DATABASE_TAB_ID, kind: 'ai' }
    return null
  }

  const activateWorkspaceTab = (tab: WorkspaceTabReference | null): void => {
    if (!tab) {
      setActiveWorkspace(null)
      return
    }
    if (tab.kind === 'database') setActiveDatabaseTabId(tab.id)
    if (tab.kind === 'tables') setActiveTableDialogId(tab.id)
    if (tab.kind === 'queries') setActiveQueryId(tab.id)
    if (tab.kind === 'data') setActiveTableDataId(tab.id)
    if (tab.kind === 'ai') setAiDatabaseOpen(true)
    setActiveWorkspace(tab.kind)
  }

  const closeWorkspaceTabSet = (tabsToClose: WorkspaceTabReference[], anchor: WorkspaceTabReference): void => {
    const allTabs = workspaceTabs()
    const closingIds = new Set(tabsToClose.map((tab) => tab.id))
    if (!closingIds.size) return
    const anchorIndex = allTabs.findIndex((tab) => tab.id === anchor.id)
    const currentActive = activeWorkspaceTab()
    const selectionIndex = currentActive ? allTabs.findIndex((tab) => tab.id === currentActive.id) : anchorIndex
    const remainingTabs = allTabs.filter((tab) => !closingIds.has(tab.id))
    setDatabaseTabs((current) => current.filter((tab) => !closingIds.has(tab.id)))
    setTableDialogs((current) => current.filter((tab) => !closingIds.has(tab.id)))
    setQueryTabs((current) => current.filter((tab) => !closingIds.has(tab.id)))
    setTableDataTabs((current) => current.filter((tab) => !closingIds.has(tab.id)))
    if (closingIds.has(AI_DATABASE_TAB_ID)) setAiDatabaseOpen(false)
    if (currentActive && closingIds.has(currentActive.id)) {
      const next = allTabs.slice(selectionIndex + 1).find((tab) => !closingIds.has(tab.id))
        ?? [...allTabs.slice(0, selectionIndex)].reverse().find((tab) => !closingIds.has(tab.id))
        ?? remainingTabs[0]
        ?? null
      activateWorkspaceTab(next)
    }
    setTabContextMenu(null)
  }

  const runTabContextAction = (action: 'current' | 'others' | 'left' | 'right'): void => {
    if (!tabContextMenu) return
    const allTabs = workspaceTabs()
    const targetIndex = allTabs.findIndex((tab) => tab.id === tabContextMenu.id)
    if (targetIndex < 0) return
    const tabsToClose = action === 'current'
      ? [allTabs[targetIndex]]
      : action === 'others'
        ? allTabs.filter((tab) => tab.id !== tabContextMenu.id)
        : action === 'left' ? allTabs.slice(0, targetIndex) : allTabs.slice(targetIndex + 1)
    closeWorkspaceTabSet(tabsToClose, tabContextMenu)
  }

  const openTabContextMenu = (event: ReactMouseEvent, tab: WorkspaceTabReference): void => {
    event.preventDefault()
    event.stopPropagation()
    setTabContextMenu({
      ...tab,
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - 154)
    })
  }

  const openDefaultQuery = (): void => {
    if (activeDatabase) openQuery(activeDatabase.connection, activeDatabase.database)
    else addQueryTab({ connectionId: null, connectionName: '', databaseName: '' })
  }

  const openAiDatabase = (): void => {
    setAiDatabaseOpen(true)
    setActiveWorkspace('ai')
  }

  const closeQuery = (id: string): void => {
    const closingIndex = queryTabs.findIndex((tab) => tab.id === id)
    const remainingTabs = queryTabs.filter((tab) => tab.id !== id)
    setQueryTabs(remainingTabs)
    if (activeQueryId === id) {
      const nextTab = remainingTabs[Math.min(closingIndex, remainingTabs.length - 1)]
      setActiveQueryId(nextTab?.id ?? null)
    }
    if (!remainingTabs.length && activeWorkspace === 'queries') {
      if (databaseTabs.length) {
        setActiveWorkspace('database')
        if (!activeDatabaseTabId && databaseTabs[0]) setActiveDatabaseTabId(databaseTabs[0].id)
      } else if (tableDataTabs.length) {
        setActiveWorkspace('data')
      } else if (tableDialogs.length) {
        setActiveWorkspace('tables')
      } else {
        setActiveWorkspace(null)
      }
    }
  }

  const updateQueryDatabase = (id: string, connectionId: number | null, databaseName: string): void => {
    const connection = connections.find((item) => item.id === connectionId)
    setQueryTabs((current) => current.map((tab) => tab.id === id ? {
      ...tab,
      context: { ...tab.context, connectionId, connectionName: connection?.name ?? '', databaseName }
    } : tab))
  }

  const databaseSaved = async (): Promise<void> => {
    setDatabaseDialog(null)
    await loadConnections()
  }

  const importTable = async (connection: DatabaseConnection, database: DatabaseItem, table: TableItem): Promise<void> => {
    const result = await window.omnidb.tables.importData(connection.id, database.name, table.name)
    if (result.message !== '已取消导入') window.alert(result.message)
    if (result.success) await loadConnections()
  }

  const exportTable = async (connection: DatabaseConnection, database: DatabaseItem, table: TableItem): Promise<void> => {
    const result = await window.omnidb.tables.exportCsv(connection.id, database.name, table.name)
    if (result.message !== '已取消导出') window.alert(result.message)
  }

  const exportSql = async (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem | undefined,
    includeData: boolean
  ): Promise<void> => {
    const result = await window.omnidb.databases.exportSql(connection.id, database.name, table?.name, includeData)
    if (result.message !== '已取消导出') window.alert(result.message)
  }

  const openTableData = (connection: DatabaseConnection, database: DatabaseItem, table: TableItem): void => {
    const existingTab = tableDataTabs.find((tab) =>
      tab.connection.id === connection.id && tab.database.name === database.name && tab.table.name === table.name)
    if (existingTab) {
      setActiveTableDataId(existingTab.id)
      setActiveWorkspace('data')
      return
    }
    const id = crypto.randomUUID()
    setTableDataTabs((current) => [...current, { id, connection, database, table }])
    setActiveTableDataId(id)
    setActiveWorkspace('data')
  }

  const closeTableData = (id: string): void => {
    const closingIndex = tableDataTabs.findIndex((tab) => tab.id === id)
    const remainingTabs = tableDataTabs.filter((tab) => tab.id !== id)
    setTableDataTabs(remainingTabs)
    if (activeTableDataId === id) {
      const nextTab = remainingTabs[Math.min(closingIndex, remainingTabs.length - 1)]
      setActiveTableDataId(nextTab?.id ?? null)
    }
    if (!remainingTabs.length && activeWorkspace === 'data') {
      if (databaseTabs.length) {
        setActiveWorkspace('database')
        if (!activeDatabaseTabId && databaseTabs[0]) setActiveDatabaseTabId(databaseTabs[0].id)
      } else if (tableDialogs.length) {
        setActiveWorkspace('tables')
      } else if (queryTabs.length) {
        setActiveWorkspace('queries')
      } else {
        setActiveWorkspace(null)
      }
    }
  }

  const designTable = (connection: DatabaseConnection, database: DatabaseItem, table: TableItem): void => {
    const id = crypto.randomUUID()
    setTableDialogs((current) => [...current, { id, connection, database, table }])
    setActiveTableDialogId(id)
    setActiveWorkspace('tables')
  }

  const openRenameTableDialog = (connection: DatabaseConnection, database: DatabaseItem, table: TableItem): void => {
    setRenameTableDialog({ connection, database, table })
    setRenameTableName(table.name)
    setRenameTableError('')
  }

  const renameTable = async (): Promise<void> => {
    if (!renameTableDialog || renamingTable) return
    const newTableName = renameTableName.trim()
    if (!newTableName) {
      setRenameTableError('请输入新的表名称')
      return
    }

    const { connection, database, table } = renameTableDialog
    setRenamingTable(true)
    setRenameTableError('')
    const result = await window.omnidb.tables.rename({
      connectionId: connection.id,
      databaseName: database.name,
      currentTableName: table.name,
      newTableName
    })
    setRenamingTable(false)
    if (!result.success) {
      setRenameTableError(result.message)
      return
    }

    setTableDialogs((current) => current.map((tab) =>
      tab.connection.id === connection.id && tab.database.name === database.name && tab.table?.name === table.name
        ? { ...tab, table: { ...tab.table, name: newTableName } }
        : tab
    ))
    setTableDataTabs((current) => current.map((tab) =>
      tab.connection.id === connection.id && tab.database.name === database.name && tab.table.name === table.name
        ? { ...tab, table: { ...tab.table, name: newTableName } }
        : tab
    ))
    setRenameTableDialog(null)
    await loadConnections()
  }

  const deleteTable = async (connection: DatabaseConnection, database: DatabaseItem, table: TableItem): Promise<void> => {
    const confirmed = await confirm({
      title: '永久删除数据表',
      message: `确定要删除数据表“${table.name}”吗？`,
      detail: `数据库“${database.name}”中的表结构和全部数据都会被永久删除，此操作无法撤销。`,
      confirmLabel: '永久删除'
    })
    if (!confirmed) return
    const result = await window.omnidb.tables.delete(connection.id, database.name, table.name)
    if (!result.success) window.alert(result.message)
    if (result.success) await loadConnections()
  }

  const truncateTable = async (connection: DatabaseConnection, database: DatabaseItem, table: TableItem): Promise<void> => {
    const confirmed = await confirm({
      title: '清空数据表',
      message: `确定要清空数据表“${table.name}”吗？`,
      detail: '表结构会保留，但表中的全部记录都会被永久删除，此操作无法撤销。',
      confirmLabel: '确认清空'
    })
    if (!confirmed) return
    const result = await window.omnidb.tables.truncate(connection.id, database.name, table.name)
    if (!result.success) window.alert(result.message)
    if (result.success) await loadConnections()
  }

  const copyTable = async (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem,
    includeData: boolean
  ): Promise<void> => {
    const targetTableName = window.prompt('请输入复制后的表名称', `${table.name}_copy`)?.trim()
    if (!targetTableName) return
    const result = await window.omnidb.tables.copy({
      connectionId: connection.id,
      databaseName: database.name,
      sourceTableName: table.name,
      targetTableName,
      includeData
    })
    window.alert(result.message)
    if (result.success) await loadConnections()
  }

  const openTableDesigner = (connection: DatabaseConnection, database: DatabaseItem): void => {
    const id = crypto.randomUUID()
    setTableDialogs((current) => [...current, { id, connection, database }])
    setActiveTableDialogId(id)
    setActiveWorkspace('tables')
  }

  const closeTableDesigner = (id: string): void => {
    const closingIndex = tableDialogs.findIndex((tab) => tab.id === id)
    const remainingTabs = tableDialogs.filter((tab) => tab.id !== id)
    setTableDialogs(remainingTabs)
    if (activeTableDialogId === id) {
      const nextTab = remainingTabs[Math.min(closingIndex, remainingTabs.length - 1)]
      setActiveTableDialogId(nextTab?.id ?? null)
    }
    if (!remainingTabs.length && activeWorkspace === 'tables') {
      if (databaseTabs.length) {
        setActiveWorkspace('database')
        if (!activeDatabaseTabId && databaseTabs[0]) setActiveDatabaseTabId(databaseTabs[0].id)
      } else if (tableDataTabs.length) {
        setActiveWorkspace('data')
      } else if (queryTabs.length) {
        setActiveWorkspace('queries')
      } else {
        setActiveWorkspace(null)
      }
    }
  }

  const tableSaved = async (id: string, tableName: string): Promise<void> => {
    setTableDialogs((current) => current.map((tab) => tab.id === id
      ? {
          ...tab,
          table: tab.table
            ? { ...tab.table, name: tableName }
            : { name: tableName, columns: [], indexes: [], foreignKeys: [], checks: [], triggers: [] }
        }
      : tab))
    await loadConnections()
  }

  const connectionSaved = async (): Promise<void> => {
    setShowConnectionDialog(false)
    setEditingConnection(null)
    await loadConnections()
  }

  const handleGenerateSql = (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem,
    sqlKind: 'select' | 'insert' | 'update' | 'delete' | 'ddl'
  ): void => {
    const isPgOrOracle = connection.engine === 'PostgreSQL' || connection.engine === 'Oracle'
    const q = (identifier: string) => isPgOrOracle ? `"${identifier}"` : `\`${identifier}\``
    const columns = table.columns ?? []
    const firstCol = columns[0] || 'id'
    let initialSql = ''
    let title = ''

    if (sqlKind === 'select') {
      initialSql = `SELECT *\nFROM ${q(table.name)}\nLIMIT 100;`
      title = `SELECT · ${table.name}`
    } else if (sqlKind === 'insert') {
      const colList = columns.length ? columns.map(q).join(', ') : 'column1, column2'
      const valList = columns.length ? columns.map(() => `'...'`).join(', ') : "'val1', 'val2'"
      initialSql = `INSERT INTO ${q(table.name)} (${colList})\nVALUES (${valList});`
      title = `INSERT · ${table.name}`
    } else if (sqlKind === 'update') {
      const setList = columns.length ? columns.map((col) => `${q(col)} = '...'`).join(',\n  ') : `${q('column')} = 'val'`
      initialSql = `UPDATE ${q(table.name)}\nSET ${setList}\nWHERE ${q(firstCol)} = '...';`
      title = `UPDATE · ${table.name}`
    } else if (sqlKind === 'delete') {
      initialSql = `DELETE FROM ${q(table.name)}\nWHERE ${q(firstCol)} = '...';`
      title = `DELETE · ${table.name}`
    } else if (sqlKind === 'ddl') {
      initialSql = `-- 查看数据表 ${table.name} 结构 DDL\nSHOW CREATE TABLE ${q(table.name)};`
      title = `DDL · ${table.name}`
    }

    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name,
      title,
      initialSql,
      autoRun: sqlKind === 'select' || sqlKind === 'ddl'
    })
  }

  const handleMaintainTable = (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem,
    action: 'check' | 'optimize' | 'analyze'
  ): void => {
    const isPgOrOracle = connection.engine === 'PostgreSQL' || connection.engine === 'Oracle'
    const q = (identifier: string) => isPgOrOracle ? `"${identifier}"` : `\`${identifier}\``
    const keywordMap = { check: 'CHECK TABLE', optimize: 'OPTIMIZE TABLE', analyze: 'ANALYZE TABLE' }
    const actionLabel = { check: '检查表', optimize: '优化表', analyze: '分析表' }
    const initialSql = `${keywordMap[action]} ${q(table.name)};`

    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name,
      title: `${actionLabel[action]} · ${table.name}`,
      initialSql,
      autoRun: true
    })
  }

  const handleShowTableInfo = (
    connection: DatabaseConnection,
    database: DatabaseItem,
    table: TableItem
  ): void => {
    setTableInfoDialog({ connection, database, table })
  }

  const handleObjectAction = async (
    connection: DatabaseConnection,
    database: DatabaseItem,
    groupKey: string,
    objectName: string,
    action: 'query' | 'ddl' | 'edit' | 'copy' | 'drop'
  ): Promise<void> => {
    const isPgOrOracle = connection.engine === 'PostgreSQL' || connection.engine === 'Oracle'
    const q = (identifier: string) => isPgOrOracle ? `"${identifier}"` : `\`${identifier}\``

    if (action === 'copy') {
      await navigator.clipboard.writeText(objectName)
      return
    }

    if (action === 'edit' && groupKey === 'procedures') {
      const template = connection.engine === 'PostgreSQL'
        ? `CREATE OR REPLACE PROCEDURE ${q(objectName)}()\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  -- 编辑过程体\nEND;\n$$;`
        : `DROP PROCEDURE IF EXISTS ${q(objectName)};\nDELIMITER $$\nCREATE PROCEDURE ${q(objectName)}()\nBEGIN\n  -- 编辑过程体\nEND$$\nDELIMITER ;`
      setAdvancedTool({ mode: 'routine', routineSql: template })
      return
    }

    if (action === 'drop') {
      const confirmed = await confirm({
        title: '确认删除对象',
        message: `确定要删除“${objectName}”吗？`,
        detail: '此操作不可撤销，请谨慎操作。',
        confirmLabel: '确认删除'
      })
      if (!confirmed) return
      const dropKeyword = groupKey === 'views' ? 'VIEW' : groupKey === 'procedures' ? 'PROCEDURE' : groupKey === 'functions' ? 'FUNCTION' : 'TABLE'
      const sql = `DROP ${dropKeyword} IF EXISTS ${q(objectName)};`
      addQueryTab({
        connectionId: connection.id,
        connectionName: connection.name,
        databaseName: database.name,
        title: `删除 · ${objectName}`,
        initialSql: sql,
        autoRun: true
      })
      return
    }

    if (action === 'query') {
      let initialSql = `SELECT * FROM ${q(objectName)} LIMIT 100;`
      if (groupKey === 'procedures') initialSql = `CALL ${q(objectName)}();`
      else if (groupKey === 'functions') initialSql = `SELECT ${q(objectName)}();`

      addQueryTab({
        connectionId: connection.id,
        connectionName: connection.name,
        databaseName: database.name,
        title: `查询 · ${objectName}`,
        initialSql,
        autoRun: true
      })
      return
    }

    if (action === 'ddl') {
      let ddlKeyword = 'VIEW'
      if (groupKey === 'procedures') ddlKeyword = 'PROCEDURE'
      else if (groupKey === 'functions') ddlKeyword = 'FUNCTION'

      addQueryTab({
        connectionId: connection.id,
        connectionName: connection.name,
        databaseName: database.name,
        title: `DDL · ${objectName}`,
        initialSql: `SHOW CREATE ${ddlKeyword} ${q(objectName)};`,
        autoRun: true
      })
    }
  }

  const handleSetConnectionColor = async (connection: DatabaseConnection, color: string): Promise<void> => {
    await window.omnidb.connections.update({
      id: connection.id,
      name: connection.name,
      engine: connection.engine as 'MySQL' | 'PostgreSQL' | 'SQLite',
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: '',
      defaultDatabase: connection.defaultDatabase,
      savePassword: true,
      color
    } as any)
    await loadConnections()
  }

  const handleExportDataDictionary = (connection: DatabaseConnection, database: DatabaseItem): void => {
    let md = `# 数据库数据字典 - ${database.name}\n\n`
    md += `> **生成时间**: ${new Date().toLocaleString('zh-CN')}\n`
    md += `> **数据库类型**: ${connection.engine}\n`
    md += `> **包含数据表数量**: ${database.tables.length} 张\n\n`
    md += `---\n\n`

    if (!database.tables.length) {
      md += `*当前数据库暂无数据表定义。*\n`
    } else {
      database.tables.forEach((table, index) => {
        md += `### ${index + 1}. 数据表：${table.name}\n\n`
        if (table.comment) md += `> **表说明**: ${table.comment}\n\n`
        md += `| 序号 | 字段名称 | 数据类型 | 约束类型 |\n`
        md += `| :--- | :--- | :--- | :--- |\n`
        table.columns.forEach((col, cIdx) => {
          const keyTag = cIdx === 0 ? '`PRIMARY KEY`' : '`COLUMN`'
          md += `| ${cIdx + 1} | \`${col}\` | \`VARCHAR/INT\` | ${keyTag} |\n`
        })
        md += `\n`
        if (table.indexes?.length) {
          md += `**索引列表**: ${table.indexes.map((i) => `\`${i}\``).join(', ')}\n\n`
        }
        md += `---\n\n`
      })
    }

    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name,
      title: `数据字典 · ${database.name}`,
      initialSql: md,
      autoRun: false
    })
  }

  const handleShowProcesslist = (connection: DatabaseConnection): void => {
    const sql = connection.engine === 'PostgreSQL'
      ? `SELECT pid, usename, datname, client_addr, state, query, query_start FROM pg_stat_activity WHERE state IS NOT NULL;`
      : `SHOW FULL PROCESSLIST;`

    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: connection.defaultDatabase || 'information_schema',
      title: `活动会话 · ${connection.name}`,
      initialSql: sql,
      autoRun: true
    })
  }

  const handleCreateObject = (
    connection: DatabaseConnection,
    database: DatabaseItem,
    groupKey: string,
    groupLabel: string
  ): void => {
    const isPgOrOracle = connection.engine === 'PostgreSQL' || connection.engine === 'Oracle'
    const q = (identifier: string) => isPgOrOracle ? `"${identifier}"` : `\`${identifier}\``

    let initialSql = ''
    if (groupKey === 'views') {
      initialSql = `CREATE VIEW ${q('new_view')}\nAS\nSELECT * FROM ${q(database.tables[0]?.name || 'table_name')};`
    } else if (groupKey === 'procedures') {
      initialSql = connection.engine === 'MySQL' || connection.engine === 'MariaDB'
        ? `DELIMITER //\nCREATE PROCEDURE ${q('new_procedure')}()\nBEGIN\n  -- SQL statements here\n  SELECT 1;\nEND //\nDELIMITER ;`
        : `CREATE OR REPLACE PROCEDURE ${q('new_procedure')}()\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  -- SQL statements here\nEND;\n$$;`
    } else if (groupKey === 'functions') {
      initialSql = connection.engine === 'MySQL' || connection.engine === 'MariaDB'
        ? `CREATE FUNCTION ${q('new_function')}(val INT)\nRETURNS INT\nDETERMINISTIC\nBEGIN\n  RETURN val * 2;\nEND;`
        : `CREATE OR REPLACE FUNCTION ${q('new_function')}(val INT)\nRETURNS INT\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  RETURN val * 2;\nEND;\n$$;`
    } else if (groupKey === 'triggers') {
      initialSql = `CREATE TRIGGER ${q('new_trigger')}\nBEFORE INSERT ON ${q(database.tables[0]?.name || 'table_name')}\nFOR EACH ROW\nBEGIN\n  -- Trigger logic\nEND;`
    } else if (groupKey === 'sequences') {
      initialSql = `CREATE SEQUENCE ${q('new_sequence')}\nSTART WITH 1\nINCREMENT BY 1;`
    } else {
      initialSql = `-- 新建 ${groupLabel}\nCREATE OBJECT ${q('new_object')};`
    }

    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name,
      title: `新建${groupLabel.slice(0, 2)}`,
      initialSql,
      autoRun: false
    })
  }

  const handleCopySqlStatement = async (
    connection: DatabaseConnection,
    _database: DatabaseItem,
    table: TableItem,
    type: 'select' | 'insert'
  ): Promise<void> => {
    const isPgOrOracle = connection.engine === 'PostgreSQL' || connection.engine === 'Oracle'
    const q = (identifier: string) => isPgOrOracle ? `"${identifier}"` : `\`${identifier}\``
    const columns = table.columns ?? []

    let sql = ''
    if (type === 'select') {
      sql = `SELECT ${columns.length ? columns.map(q).join(', ') : '*'} FROM ${q(table.name)};`
    } else {
      const colList = columns.length ? columns.map(q).join(', ') : 'col1, col2'
      const valList = columns.length ? columns.map(() => `'...'`).join(', ') : "'val1', 'val2'"
      sql = `INSERT INTO ${q(table.name)} (${colList}) VALUES (${valList});`
    }

    await navigator.clipboard.writeText(sql)
  }

  const handleTruncateDatabase = async (
    connection: DatabaseConnection,
    database: DatabaseItem
  ): Promise<void> => {
    const isProd = connection.color === '#ef4444'
    const confirmed = await confirm({
      title: isProd ? '⚠️ 生产环境危险操作：清空全库表数据' : '清空数据库中所有数据表',
      message: `确定要清空数据库“${database.name}”中的全部表数据吗？`,
      detail: isProd
        ? '【警告】此连接被标记为【生产环境 PROD】，清空后数据无法挽回！'
        : `包含 ${database.tables.length} 张表的全部数据将被彻底删除，表结构保持不变。`,
      confirmLabel: '危险确认：清空全部数据'
    })
    if (!confirmed) return

    const isPgOrOracle = connection.engine === 'PostgreSQL' || connection.engine === 'Oracle'
    const q = (identifier: string) => isPgOrOracle ? `"${identifier}"` : `\`${identifier}\``
    const truncateSql = database.tables.map((table) => `TRUNCATE TABLE ${q(table.name)};`).join('\n')

    addQueryTab({
      connectionId: connection.id,
      connectionName: connection.name,
      databaseName: database.name,
      title: `清空全库表数据 · ${database.name}`,
      initialSql: `-- 批量清空数据库 ${database.name} 内所有表数据\n${truncateSql}`,
      autoRun: false
    })
  }

  const handleCopyDatabase = async (
    connection: DatabaseConnection,
    database: DatabaseItem,
    includeData: boolean
  ): Promise<void> => {
    const newDbName = window.prompt(
      `请输入复制后的新数据库名称（${includeData ? '包含结构和数据' : '仅包含结构'}）`,
      `${database.name}_copy`
    )?.trim()
    if (!newDbName) return

    const createRes = await window.omnidb.databases.create({
      connectionId: connection.id,
      name: newDbName,
      charset: database.charset || 'utf8mb4',
      collation: database.collation || 'utf8mb4_general_ci'
    })

    if (!createRes.success) {
      window.alert(`创建目标数据库失败: ${createRes.message}`)
      return
    }

    let successCount = 0
    let failCount = 0

    for (const table of database.tables) {
      const res = await window.omnidb.tables.copy({
        connectionId: connection.id,
        databaseName: database.name,
        targetDatabaseName: newDbName,
        sourceTableName: table.name,
        targetTableName: table.name,
        includeData
      })
      if (res.success) successCount++
      else failCount++
    }

    window.alert(`数据库复制完成！\n新数据库：${newDbName}\n成功复制 ${successCount} 张表${failCount ? `，${failCount} 张表失败` : ''}`)
    await loadConnections()
  }

  const contextMenuTabs = workspaceTabs()
  const contextMenuTabIndex = tabContextMenu ? contextMenuTabs.findIndex((tab) => tab.id === tabContextMenu.id) : -1
  const activeTabReference = activeWorkspaceTab()
  const activeTabIndex = activeTabReference ? contextMenuTabs.findIndex((tab) => tab.id === activeTabReference.id) : 0
  const visibleTabStart = contextMenuTabs.length <= maxVisibleWorkspaceTabs
    ? 0
    : Math.max(0, Math.min(
      activeTabIndex - Math.floor((maxVisibleWorkspaceTabs - 1) / 2),
      contextMenuTabs.length - maxVisibleWorkspaceTabs
    ))
  const visibleWorkspaceTabs = contextMenuTabs.slice(visibleTabStart, visibleTabStart + maxVisibleWorkspaceTabs)
  const visibleWorkspaceTabIds = new Set(visibleWorkspaceTabs.map((tab) => tab.id))
  const hiddenWorkspaceTabs = contextMenuTabs.filter((tab) => !visibleWorkspaceTabIds.has(tab.id))
  const workspaceTabLabel = (tab: WorkspaceTabReference): string => {
    if (tab.kind === 'database') {
      const item = databaseTabs.find((candidate) => candidate.id === tab.id)
      return `数据表 · ${item?.databaseName ?? '数据库'}`
    }
    if (tab.kind === 'tables') {
      const item = tableDialogs.find((candidate) => candidate.id === tab.id)
      return item?.table ? `设计表 · ${item.table.name}` : `新建表 · ${item?.database.name ?? '数据库'}`
    }
    if (tab.kind === 'queries') {
      const item = queryTabs.find((candidate) => candidate.id === tab.id)
      return item?.context.title || `查询 · ${item?.context.databaseName || '未选择数据库'}`
    }
    if (tab.kind === 'ai') return 'AI数据库'
    const item = tableDataTabs.find((candidate) => candidate.id === tab.id)
    return `数据 · ${item?.table.name ?? '数据表'}`
  }

  return (
    <div className={`app${isMacOS ? ' platform-macos' : ''}`}>
      <header className="toolbar">
        <div className="brand">
          <span className="brand-icon"><img src={omniDbIcon} alt="" /></span>
          <span className="brand-name">OrbiSQL</span>
        </div>

        <div className="toolbar-actions">
          <button className="tool-button primary" onClick={openNewConnectionDialog}>
            <Plus weight="bold" />
            <span>新建连接</span>
          </button>
          <button className="tool-button" onClick={() => setShowConnectionGroupDialog(true)}><FolderOpen weight="fill" /><span>新建分组</span></button>
          <span className="toolbar-divider" />
          <button className="tool-button" onClick={openDefaultQuery}><FileSql /><span>新建查询</span></button>
          <button className="tool-button" onClick={() => setAdvancedTool({ mode: 'schema' })}><GitDiff /><span>高级工具</span></button>
          {isHarmonyPlatform() && <button className="tool-button" onClick={() => setShowSettingsDialog(true)}><GearSix /><span>设置</span></button>}
        </div>
      </header>

      <div className="workbench">
        <ConnectionSidebar
          connections={connections}
          loading={connectionsLoading}
          groupsRefreshRequest={groupsRefreshRequest}
          onNewConnection={openNewConnectionDialog}
          onGroupsChanged={() => void loadConnections()}
          onEditConnection={openEditConnectionDialog}
          onToggleConnection={toggleConnection}
          onDuplicateConnection={(connection) => void duplicateConnection(connection)}
          onDeleteConnection={(connection) => void deleteConnection(connection)}
          onRefreshConnection={() => void loadConnections()}
          onRunSqlFile={(connection) => void runSqlFile(connection)}
          onCreateDatabase={(connection) => setDatabaseDialog({ connection, database: null })}
          onEditDatabase={(connection, database) => setDatabaseDialog({ connection, database })}
          onDeleteDatabase={(connection, database) => void deleteDatabase(connection, database)}
          onNewQuery={openQuery}
          onRunDatabaseSqlFile={(connection, database) => void runDatabaseSqlFile(connection, database)}
          onExportSql={(connection, database, table, includeData) => void exportSql(connection, database, table, includeData)}
          onDatabaseOpenStateChange={(connection, database, open) => {
            if (open) setActiveDatabase({ connection, database })
            else if (activeDatabase?.connection.id === connection.id && activeDatabase.database.name === database.name) setActiveDatabase(null)
          }}
          onSelectDatabase={openDatabaseOverview}
          onLoadDatabase={async (connection, database) => {
            try {
              const loadedConnections = await loadConnections()
              const loadedConnection = loadedConnections.find((item) => item.id === connection.id)
              const loadedDatabase = loadedConnection?.databases.find((item) => item.name === database.name)
              return loadedConnection && loadedDatabase ? { connection: loadedConnection, database: loadedDatabase } : null
            } catch {
              return null
            }
          }}
          onCreateTable={(connection, database) => openTableDesigner(connection, database)}
          onOpenTable={openTableData}
          onDesignTable={designTable}
          onRenameTable={openRenameTableDialog}
          onDeleteTable={(connection, database, table) => void deleteTable(connection, database, table)}
          onTruncateTable={(connection, database, table) => void truncateTable(connection, database, table)}
          onCopyTable={(connection, database, table, includeData) => void copyTable(connection, database, table, includeData)}
          onExportTable={(connection, database) => setTablePicker({ connection, database, mode: 'export' })}
          onSelectImportTable={(connection, database) => setTablePicker({ connection, database, mode: 'import' })}
          onSelectExportTable={(connection, database) => setTablePicker({ connection, database, mode: 'export' })}
          onGenerateSql={handleGenerateSql}
          onMaintainTable={handleMaintainTable}
          onShowTableInfo={(connection, database, table) => void handleShowTableInfo(connection, database, table)}
          onObjectAction={(connection, database, groupKey, objectName, action) => void handleObjectAction(connection, database, groupKey, objectName, action)}
          onSetConnectionColor={(connection, color) => void handleSetConnectionColor(connection, color)}
          onExportDataDictionary={handleExportDataDictionary}
          onShowProcesslist={handleShowProcesslist}
          onCreateObject={handleCreateObject}
          onCopySqlStatement={(connection, database, table, type) => void handleCopySqlStatement(connection, database, table, type)}
          onTruncateDatabase={(connection, database) => void handleTruncateDatabase(connection, database)}
          onCopyDatabase={(connection, database, includeData) => void handleCopyDatabase(connection, database, includeData)}
        />

        <main className="content-area table-designer-workspace query-workspace-shell">
            <div ref={workspaceTabbarRef} className="workspace-tabbar">
            <div className="content-tabs table-designer-window-tabs query-window-tabs" role="tablist">
              <div
                className={`home-tab workbench-tab${activeWorkspace === null ? ' active' : ''}`}
                role="tab"
                aria-selected={activeWorkspace === null}
                tabIndex={0}
                onClick={() => setActiveWorkspace(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') setActiveWorkspace(null)
                }}
              >
                <Database weight="fill" /><span>工作台</span>
              </div>
              {databaseTabs.filter((tab) => visibleWorkspaceTabIds.has(tab.id)).map((tab) => (
                <div
                  className={`home-tab query-tab database-overview-tab${pinnedTabIds.has(tab.id) ? ' pinned' : ''}${activeWorkspace === 'database' && activeDatabaseTabId === tab.id ? ' active' : ''}`}
                  key={tab.id}
                  role="tab"
                  tabIndex={0}
                  title={`${tab.connectionName} / ${tab.databaseName}`}
                  onContextMenu={(event) => openTabContextMenu(event, { id: tab.id, kind: 'database' })}
                  onClick={() => { setActiveDatabaseTabId(tab.id); setActiveWorkspace('database') }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setActiveDatabaseTabId(tab.id)
                      setActiveWorkspace('database')
                    }
                  }}
                >
                  <Database weight="fill" />
                  <span>数据表 · {tab.databaseName}</span>
                  <button type="button" className="tab-pin-btn" title={pinnedTabIds.has(tab.id) ? '取消固定' : '固定标签页'} onClick={(event) => { event.stopPropagation(); togglePinTab(tab.id) }}><PushPin weight={pinnedTabIds.has(tab.id) ? 'fill' : 'regular'} /></button>
                  {!pinnedTabIds.has(tab.id) && <button type="button" onClick={(event) => { event.stopPropagation(); closeDatabaseOverview(tab.id) }} aria-label={`关闭 ${tab.databaseName} 数据表页面`}><X /></button>}
                </div>
              ))}
              {tableDialogs.filter((tab) => visibleWorkspaceTabIds.has(tab.id)).map((tab) => (
                <div
                  className={`home-tab query-tab table-designer-tab${activeWorkspace === 'tables' && activeTableDialogId === tab.id ? ' active' : ''}`}
                  key={tab.id}
                  role="tab"
                  tabIndex={0}
                  title={`${tab.connection.name} / ${tab.database.name}${tab.table ? ` / ${tab.table.name}` : ''}`}
                  onContextMenu={(event) => openTabContextMenu(event, { id: tab.id, kind: 'tables' })}
                  onClick={() => { setActiveTableDialogId(tab.id); setActiveWorkspace('tables') }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setActiveTableDialogId(tab.id)
                      setActiveWorkspace('tables')
                    }
                  }}
                >
                  <Database weight="fill" />
                  <span>{tab.table ? `设计表 · ${tab.table.name}` : `新建表 · ${tab.database.name}`}</span>
                  <button type="button" onClick={(event) => { event.stopPropagation(); closeTableDesigner(tab.id) }} aria-label={`关闭 ${tab.database.name} 新建表页面`}><X /></button>
                </div>
              ))}
              {queryTabs.filter((tab) => visibleWorkspaceTabIds.has(tab.id)).map((tab) => (
                <div
                  className={`home-tab query-tab query-document-tab${activeWorkspace === 'queries' && activeQueryId === tab.id ? ' active' : ''}`}
                  key={tab.id}
                  role="tab"
                  tabIndex={0}
                  title={`${tab.context.connectionName || '未选择连接'} / ${tab.context.databaseName || '未选择数据库'}`}
                  onContextMenu={(event) => openTabContextMenu(event, { id: tab.id, kind: 'queries' })}
                  onClick={() => { setActiveQueryId(tab.id); setActiveWorkspace('queries') }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setActiveQueryId(tab.id)
                      setActiveWorkspace('queries')
                    }
                  }}
                >
                  <Code />
                  <span>{tab.context.title || `查询 · ${tab.context.databaseName || '未选择数据库'}`}</span>
                  <button type="button" onClick={(event) => { event.stopPropagation(); closeQuery(tab.id) }} aria-label="关闭查询页面"><X /></button>
                </div>
              ))}
              {tableDataTabs.filter((tab) => visibleWorkspaceTabIds.has(tab.id)).map((tab) => (
                <div
                  className={`home-tab query-tab table-data-tab${activeWorkspace === 'data' && activeTableDataId === tab.id ? ' active' : ''}`}
                  key={tab.id}
                  role="tab"
                  tabIndex={0}
                  title={`${tab.connection.name} / ${tab.database.name} / ${tab.table.name}`}
                  onContextMenu={(event) => openTabContextMenu(event, { id: tab.id, kind: 'data' })}
                  onClick={() => { setActiveTableDataId(tab.id); setActiveWorkspace('data') }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setActiveTableDataId(tab.id)
                      setActiveWorkspace('data')
                    }
                  }}
                >
                  <Rows />
                  <span>数据 · {tab.table.name}</span>
                  <button type="button" onClick={(event) => { event.stopPropagation(); closeTableData(tab.id) }} aria-label={`关闭 ${tab.table.name} 数据页面`}><X /></button>
                </div>
              ))}
              {aiDatabaseOpen && visibleWorkspaceTabIds.has(AI_DATABASE_TAB_ID) && (
                <div
                  className={`home-tab query-tab ai-database-tab${activeWorkspace === 'ai' ? ' active' : ''}`}
                  role="tab"
                  tabIndex={0}
                  title="AI数据库"
                  onContextMenu={(event) => openTabContextMenu(event, { id: AI_DATABASE_TAB_ID, kind: 'ai' })}
                  onClick={() => setActiveWorkspace('ai')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setActiveWorkspace('ai')
                  }}
                >
                  <Sparkle weight="fill" />
                  <span>AI数据库</span>
                  <button type="button" onClick={(event) => { event.stopPropagation(); closeWorkspaceTabSet([{ id: AI_DATABASE_TAB_ID, kind: 'ai' }], { id: AI_DATABASE_TAB_ID, kind: 'ai' }) }} aria-label="关闭 AI数据库"><X /></button>
                </div>
              )}
            </div>
            <div className={`workspace-tab-overflow-host${hiddenWorkspaceTabs.length ? '' : ' empty'}`}>
              {hiddenWorkspaceTabs.length > 0 && <>
                <button
                  type="button"
                  className={`workspace-tab-more${showTabOverflow ? ' active' : ''}`}
                  title={`${hiddenWorkspaceTabs.length} 个其他页面`}
                  aria-label="显示其他页面"
                  aria-expanded={showTabOverflow}
                  onClick={(event) => { event.stopPropagation(); setShowTabOverflow((current) => !current) }}
                >
                  <DotsThree weight="bold" />
                  <span>{hiddenWorkspaceTabs.length}</span>
                </button>
                {showTabOverflow && <div className="workspace-tab-overflow-menu" onClick={(event) => event.stopPropagation()}>
                  <header><strong>其他页面</strong><span>{hiddenWorkspaceTabs.length}</span></header>
                  <div>
                    {hiddenWorkspaceTabs.map((tab) => <div className="workspace-tab-overflow-item" key={tab.id} onContextMenu={(event) => openTabContextMenu(event, tab)}>
                      <button type="button" className="workspace-tab-overflow-open" title={workspaceTabLabel(tab)} onClick={() => { activateWorkspaceTab(tab); setShowTabOverflow(false) }}>
                        {tab.kind === 'queries' ? <Code /> : tab.kind === 'data' ? <Rows /> : <Database weight="fill" />}
                        <span>{workspaceTabLabel(tab)}</span>
                      </button>
                      <button type="button" className="workspace-tab-overflow-close" title="关闭页面" aria-label={`关闭 ${workspaceTabLabel(tab)}`} onClick={() => closeWorkspaceTabSet([tab], tab)}><X /></button>
                    </div>)}
                  </div>
                </div>}
              </>}
            </div>
            </div>
            {activeWorkspace === null && <>
              <section className="welcome">
                <div className="welcome-mark"><Database weight="duotone" /></div>
                <h1>开始使用 OrbiSQL</h1>
                <p>从左侧选择一个数据库，或创建新连接来管理你的数据。</p>
                <div className="quick-actions">
                  <button className="quick-card" onClick={openNewConnectionDialog}>
                    <span className="quick-icon blue"><Plus /></span>
                    <span><strong>新建连接</strong><small>连接 PostgreSQL、MySQL 或 SQLite</small></span>
                    <CaretRight />
                  </button>
                  <button className="quick-card" onClick={openDefaultQuery}>
                    <span className="quick-icon violet"><FileSql /></span>
                    <span><strong>新建 SQL 查询</strong><small>打开查询编辑器并执行 SQL</small></span>
                    <CaretRight />
                  </button>
                  <button type="button" className="quick-card" title="AI数据库" onClick={openAiDatabase}>
                    <span className="quick-icon cyan"><Sparkle weight="fill" /></span>
                    <span><strong>AI数据库</strong><small>使用 AI 辅助分析和管理数据库</small></span>
                    <CaretRight />
                  </button>
                  <button type="button" className="quick-card" onClick={() => setAdvancedTool({ mode: 'schema' })}>
                    <span className="quick-icon violet"><GitDiff /></span>
                    <span><strong>结构与数据对比</strong><small>对比数据库结构和表数据差异</small></span>
                    <CaretRight />
                  </button>
                  <button type="button" className="quick-card" onClick={() => setAdvancedTool({ mode: 'er' })}>
                    <span className="quick-icon cyan"><FlowArrow /></span>
                    <span><strong>ER 关系图</strong><small>根据外键生成数据库关系视图</small></span>
                    <CaretRight />
                  </button>
                </div>
                {recentConnections.length > 0 && (
                  <div className="welcome-recent">
                    <h3><WifiHigh />最近使用</h3>
                    <div className="welcome-recent-list">
                      {recentConnections.map((r: { connectionId: number; connectionName: string; databaseName: string; engine: string; ts: number }) => {
                        const conn = connections.find((c) => c.id === r.connectionId)
                        const db = conn?.databases.find((d) => d.name === r.databaseName)
                        return (
                          <button key={`${r.connectionId}-${r.databaseName}-${r.ts}`} className="welcome-recent-item" title={`${r.connectionName} / ${r.databaseName}`}
                            onClick={() => conn && db && openQuery(conn, db)}
                          >
                            <span className={`recent-engine-badge engine-${r.engine.toLowerCase()}`}>{r.engine.slice(0, 2).toUpperCase()}</span>
                            <span className="recent-db-info">
                              <strong>{r.databaseName}</strong>
                              <small>{r.connectionName}</small>
                            </span>
                            <Code />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </section>
              <footer className="status-bar">
                <span><i className="footer-status" /> 就绪</span>
                {statusInfo.ping !== null && <span className="status-ping">🟢 {statusInfo.ping}ms</span>}
                <span className="status-push">{statusInfo.charset || 'UTF-8'}</span>
                {statusInfo.version && <span>v{statusInfo.version}</span>}
                <span>OrbiSQL 0.1.0</span>
              </footer>
            </>}
            {databaseTabs.map((tab) => {
              const connection = connections.find((item) => item.id === tab.connectionId)
              const database = connection?.databases.find((item) => item.name === tab.databaseName)
              return connection && database ? (
                <DatabaseTablesWorkspace
                  key={tab.id}
                  active={activeWorkspace === 'database' && activeDatabaseTabId === tab.id}
                  connection={connection}
                  database={database}
                  onOpenTable={openTableData}
                  onDesignTable={designTable}
                  onCreateTable={(conn, db) => openTableDesigner(conn, db)}
                  onRenameTable={openRenameTableDialog}
                  onDeleteTable={(conn, db, tbl) => void deleteTable(conn, db, tbl)}
                  onTruncateTable={(conn, db, tbl) => void truncateTable(conn, db, tbl)}
                  onCopyTable={(conn, db, tbl, inc) => void copyTable(conn, db, tbl, inc)}
                  onSelectImportTable={(c, d) => setTablePicker({ connection: c, database: d, mode: 'import' })}
                  onSelectExportTable={(c, d) => setTablePicker({ connection: c, database: d, mode: 'export' })}
                  onGenerateSql={handleGenerateSql}
                  onMaintainTable={handleMaintainTable}
                  onShowTableInfo={(conn, db, tbl) => void handleShowTableInfo(conn, db, tbl)}
                  onCopySqlStatement={(conn, db, tbl, type) => void handleCopySqlStatement(conn, db, tbl, type)}
                  onExportDataDictionary={handleExportDataDictionary}
                />
              ) : null
            })}
            {tableDialogs.map((tab) => (
              <TableDialog
                key={tab.id}
                active={activeWorkspace === 'tables' && activeTableDialogId === tab.id}
                connection={tab.connection}
                database={tab.database}
                table={tab.table}
                onSaved={(tableName) => void tableSaved(tab.id, tableName)}
              />
            ))}
            {queryTabs.map((tab) => (
              <QueryWorkspace
                key={tab.id}
                sessionId={tab.id}
                active={activeWorkspace === 'queries' && activeQueryId === tab.id}
                connections={connections}
                context={tab.context}
                onDatabaseChange={(connectionId, databaseName) => updateQueryDatabase(tab.id, connectionId, databaseName)}
              />
            ))}
            {tableDataTabs.map((tab) => (
              <TableDataWorkspace
                key={tab.id}
                active={activeWorkspace === 'data' && activeTableDataId === tab.id}
                connection={tab.connection}
                database={tab.database}
                table={tab.table}
                onDesignTable={designTable}
              />
            ))}
            {aiDatabaseOpen && <AiDatabaseWorkspace active={activeWorkspace === 'ai'} connections={connections} onOpenQueryTab={openQueryWithSql} />}
          </main>
      </div>
      {tabContextMenu && (
        <div
          className="connection-context-menu tab-context-menu"
          style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => runTabContextAction('current')}><X />关闭当前</button>
          <button type="button" disabled={contextMenuTabs.length <= 1} onClick={() => runTabContextAction('others')}><Rows />关闭其他</button>
          <span className="context-menu-divider" />
          <button type="button" disabled={contextMenuTabIndex <= 0} onClick={() => runTabContextAction('left')}><CaretLeft />关闭左侧</button>
          <button type="button" disabled={contextMenuTabIndex < 0 || contextMenuTabIndex >= contextMenuTabs.length - 1} onClick={() => runTabContextAction('right')}><CaretRight />关闭右侧</button>
        </div>
      )}
      {showConnectionDialog && (
        <ConnectionDialog
          editingConnection={editingConnection}
          onClose={() => {
            setShowConnectionDialog(false)
            setEditingConnection(null)
          }}
          onSaved={() => void connectionSaved()}
        />
      )}
      {showConnectionGroupDialog && <ConnectionGroupDialog onClose={() => setShowConnectionGroupDialog(false)} onCreated={() => { setShowConnectionGroupDialog(false); setGroupsRefreshRequest((current) => current + 1); void loadConnections() }} />}
      {advancedTool && <DatabaseAdvancedTools connections={connections} initialMode={advancedTool.mode} initialRoutineSql={advancedTool.routineSql} onClose={() => setAdvancedTool(null)} />}
      {databaseDialog && (
        <DatabaseDialog
          connection={databaseDialog.connection}
          database={databaseDialog.database}
          onClose={() => setDatabaseDialog(null)}
          onSaved={() => void databaseSaved()}
        />
      )}
      {tablePicker && (
        <TablePickerDialog
          database={tablePicker.database}
          mode={tablePicker.mode}
          onClose={() => setTablePicker(null)}
          onConfirm={(table) => {
            const picker = tablePicker
            setTablePicker(null)
            if (picker.mode === 'import') void importTable(picker.connection, picker.database, table)
            else void exportTable(picker.connection, picker.database, table)
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
          onNameChange={(name) => { setRenameTableName(name); setRenameTableError('') }}
          onCancel={() => {
            if (renamingTable) return
            setRenameTableDialog(null)
            setRenameTableError('')
          }}
          onSave={() => void renameTable()}
        />
      )}
      {tableInfoDialog && (
        <TableInfoDialog
          connection={tableInfoDialog.connection}
          database={tableInfoDialog.database}
          table={tableInfoDialog.table}
          onClose={() => setTableInfoDialog(null)}
        />
      )}
      {confirmDialog}
      {showSettingsDialog && (
        <SettingsDialog
          language={language}
          theme={theme}
          onLanguageChange={setLanguage}
          onThemeChange={setTheme}
          onClose={() => setShowSettingsDialog(false)}
        />
      )}
      {showAboutDialog && <AboutDialog onClose={() => setShowAboutDialog(false)} />}
    </div>
  )
}

export default App
