import type { DatabaseConnection, DatabaseItem } from '../../../shared/connections'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useDatabaseTabsStore } from '../stores/tabs/useDatabaseTabs'
import { useQueryTabsStore } from '../stores/tabs/useQueryTabs'
import { useTableDataTabsStore } from '../stores/tabs/useTableDataTabs'
import { useTableDesignerTabsStore } from '../stores/tabs/useTableDesignerTabs'
import { useTabStore } from '../stores/useTabStore'
import { useSidebarStore } from '../stores/useSidebarStore'
import { useUIStore } from '../stores/useUIStore'
import { useDialogStore } from '../stores/useDialogStore'

/**
 * 工作区动作：新建连接对话框、打开查询标签、默认查询、
 * 切换查询数据库等跨 store 的协调逻辑，供布局组件回调使用。
 */
export function useWorkspaceActions(): {
  handleOpenNewConnectionDialog: () => void
  openQuery: (connection: DatabaseConnection, database: DatabaseItem) => void
  openQueryWithSql: (connectionId: number | null, databaseName: string, sql: string) => void
  openDefaultQuery: () => void
  updateQueryDatabase: (id: string, connectionId: number | null, databaseName: string) => void
} {
  const connections = useConnectionStore((s) => s.connections)
  const activeWorkspace = useTabStore((s) => s.activeWorkspace)
  const activeDatabaseTabId = useDatabaseTabsStore((s) => s.activeDatabaseTabId)
  const databaseTabs = useDatabaseTabsStore((s) => s.databaseTabs)
  const activeTableDataId = useTableDataTabsStore((s) => s.activeTableDataId)
  const tableDataTabs = useTableDataTabsStore((s) => s.tableDataTabs)
  const activeTableDialogId = useTableDesignerTabsStore((s) => s.activeTableDialogId)
  const tableDialogs = useTableDesignerTabsStore((s) => s.tableDialogs)
  const activeQueryId = useQueryTabsStore((s) => s.activeQueryId)
  const queryTabs = useQueryTabsStore((s) => s.queryTabs)
  const addQueryTab = useQueryTabsStore((s) => s.addQueryTab)
  const openQueryWithSqlAction = useQueryTabsStore((s) => s.openQueryWithSql)
  const updateQueryDatabaseAction = useQueryTabsStore((s) => s.updateQueryDatabase)
  const dialogActions = useDialogStore((s) => s.actions)
  const uiActions = useUIStore((s) => s.actions)

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

  return { handleOpenNewConnectionDialog, openQuery, openQueryWithSql, openDefaultQuery, updateQueryDatabase }
}
