import { useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { useDatabaseTabsStore } from '../stores/tabs/useDatabaseTabs'
import { useQueryTabsStore } from '../stores/tabs/useQueryTabs'
import { useTableDataTabsStore } from '../stores/tabs/useTableDataTabs'
import { useTableDesignerTabsStore } from '../stores/tabs/useTableDesignerTabs'
import { useTerminalTabsStore } from '../stores/tabs/useTerminalTabs'
import { useTabStore } from '../stores/useTabStore'

/**
 * 标签栏可视容量：根据标签总量与容器宽度计算可读标签数量，
 * 超出时预留溢出按钮宽度，并在溢出菜单打开时挂载全局关闭监听。
 */
export function useWorkspaceTabCapacity(): {
  showTabOverflow: boolean
  setShowTabOverflow: Dispatch<SetStateAction<boolean>>
  maxVisibleWorkspaceTabs: number
  workspaceTabbarRef: RefObject<HTMLDivElement | null>
} {
  const databaseTabs = useDatabaseTabsStore((s) => s.databaseTabs)
  const tableDialogs = useTableDesignerTabsStore((s) => s.tableDialogs)
  const queryTabs = useQueryTabsStore((s) => s.queryTabs)
  const tableDataTabs = useTableDataTabsStore((s) => s.tableDataTabs)
  const sshTerminalTabs = useTerminalTabsStore((s) => s.sshTerminalTabs)
  const aiDatabaseOpen = useTabStore((s) => s.aiDatabaseOpen)

  const [showTabOverflow, setShowTabOverflow] = useState(false)
  const [maxVisibleWorkspaceTabs, setMaxVisibleWorkspaceTabs] = useState(1)
  const workspaceTabbarRef = useRef<HTMLDivElement>(null)

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

  return { showTabOverflow, setShowTabOverflow, maxVisibleWorkspaceTabs, workspaceTabbarRef }
}
