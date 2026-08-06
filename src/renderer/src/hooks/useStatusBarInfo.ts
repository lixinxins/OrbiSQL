import { useEffect } from 'react'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useDatabaseTabsStore } from '../stores/tabs/useDatabaseTabs'
import { useQueryTabsStore } from '../stores/tabs/useQueryTabs'
import { useTerminalTabsStore } from '../stores/tabs/useTerminalTabs'
import { useTabStore } from '../stores/useTabStore'
import { useSidebarStore } from '../stores/useSidebarStore'
import { useUIStore } from '../stores/useUIStore'

/**
 * 底部状态栏：按当前激活标签/聚焦连接定时 Ping 数据库，
 * 汇总已连接数据库与 SSH 会话数量并写回 UI store。
 */
export function useStatusBarInfo(): void {
  const connections = useConnectionStore((s) => s.connections)
  const sshTerminalTabs = useTerminalTabsStore((s) => s.sshTerminalTabs)
  const activeWorkspace = useTabStore((s) => s.activeWorkspace)
  const activeDatabaseTabId = useDatabaseTabsStore((s) => s.activeDatabaseTabId)
  const databaseTabs = useDatabaseTabsStore((s) => s.databaseTabs)
  const activeQueryId = useQueryTabsStore((s) => s.activeQueryId)
  const queryTabs = useQueryTabsStore((s) => s.queryTabs)
  const focusedConnectionId = useSidebarStore((s) => s.focusedConnectionId)
  const uiActions = useUIStore((s) => s.actions)

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
}
