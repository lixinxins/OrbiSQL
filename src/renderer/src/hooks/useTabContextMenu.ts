import { useEffect } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useDatabaseTabsStore } from '../stores/tabs/useDatabaseTabs'
import { useQueryTabsStore } from '../stores/tabs/useQueryTabs'
import { useTableDataTabsStore } from '../stores/tabs/useTableDataTabs'
import { useTableDesignerTabsStore } from '../stores/tabs/useTableDesignerTabs'
import { useTerminalTabsStore } from '../stores/tabs/useTerminalTabs'
import { useDocTabsStore } from '../stores/tabs/useDocTabs'
import { useTabStore, AI_DATABASE_TAB_ID } from '../stores'
import { useUIStore } from '../stores/useUIStore'
import type { WorkspaceTabReference } from '../stores'

/**
 * 标签页右键菜单：构建全量工作区标签引用、定位目标标签、
 * 执行 当前/其他/左侧/右侧 关闭动作，并在菜单打开时挂载全局关闭监听。
 */
export function useTabContextMenu(): {
  contextMenuTabs: WorkspaceTabReference[]
  contextMenuTabIndex: number
  openTabContextMenu: (event: ReactMouseEvent, tab: WorkspaceTabReference) => void
  runTabContextAction: (action: 'current' | 'others' | 'left' | 'right') => void
} {
  const databaseTabs = useDatabaseTabsStore((s) => s.databaseTabs)
  const tableDialogs = useTableDesignerTabsStore((s) => s.tableDialogs)
  const queryTabs = useQueryTabsStore((s) => s.queryTabs)
  const tableDataTabs = useTableDataTabsStore((s) => s.tableDataTabs)
  const sshTerminalTabs = useTerminalTabsStore((s) => s.sshTerminalTabs)
  const docTabs = useDocTabsStore((s) => s.docTabs)
  const aiDatabaseOpen = useTabStore((s) => s.aiDatabaseOpen)
  const closeDatabaseOverview = useDatabaseTabsStore((s) => s.closeDatabaseOverview)
  const closeTableDesigner = useTableDesignerTabsStore((s) => s.closeTableDesigner)
  const closeQuery = useQueryTabsStore((s) => s.closeQuery)
  const closeTableData = useTableDataTabsStore((s) => s.closeTableData)
  const closeSshTerminal = useTerminalTabsStore((s) => s.closeSshTerminal)
  const closeWithFallback = useTabStore((s) => s.closeWithFallback)
  const tabContextMenu = useUIStore((s) => s.tabContextMenu)
  const uiActions = useUIStore((s) => s.actions)

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

  const contextMenuTabs = buildWorkspaceTabs()
  const contextMenuTabIndex = tabContextMenu
    ? contextMenuTabs.findIndex((tab) => tab.id === tabContextMenu.id)
    : -1

  return { contextMenuTabs, contextMenuTabIndex, openTabContextMenu, runTabContextAction }
}
