import { createPortal } from 'react-dom'
import React, { useState } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import type { ConnectionGroup, DatabaseConnection } from '@/shared/connections'
import { useSidebarStore } from '../stores/useSidebarStore'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useTerminalTabsStore } from '../stores/tabs/useTerminalTabs'
import { useQueryTabsStore } from '../stores/tabs/useQueryTabs'
import { useTableDataTabsStore } from '../stores/tabs/useTableDataTabs'
import { useTableDesignerTabsStore } from '../stores/tabs/useTableDesignerTabs'
import { useDialogStore } from '../stores/useDialogStore'
import { useTableOperations } from '../hooks/useTableOperations'
import { useConfirmDialog } from './ConfirmDialog'
import { useToast } from '../contexts/ToastContext'
import { getCommandsForKind, type MenuCommand, type CommandContext } from './sidebar-menu/command-registry'
import type { SidebarContextMenuState } from '../stores/useSidebarStore'

interface SidebarContextMenuProps {
  connectionGroups: ConnectionGroup[]
  expandedDatabases: Set<string>
  onToggleConnectionFromMenu: (connection: DatabaseConnection) => Promise<void>
  onDatabaseClick: (
    databaseKey: string,
    connection: DatabaseConnection,
    database: import('@/shared/connections').DatabaseItem
  ) => Promise<void>
  onAssignGroup: (connectionId: number, groupId: number | null) => Promise<void>
  collapsedConnectionGroups: Set<number>
  onExpandConnectionGroup: (groupId: number) => void
  onCollapseConnectionGroup: (groupId: number) => void
  onExpandAllGroups?: (category: 'database' | 'ssh') => void
  onCollapseAllGroups?: (category: 'database' | 'ssh') => void
  onRefreshConnections?: () => void
}

/** 子菜单组件 */
function SubMenu({
  command,
  menu,
  ctx,
  parentX,
}: {
  command: MenuCommand
  menu: Exclude<SidebarContextMenuState, null>
  ctx: CommandContext
  parentX: number
}) {
  const [open, setOpen] = useState(false)
  const children = command.children?.(menu) ?? []
  const visibleChildren = children.filter((c) => c.visible?.(menu) !== false)

  return (
    <div
      className="context-submenu-host"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button type="button">
        {command.icon && <command.icon />}
        <span className="context-menu-label">{command.label}</span>
        <CaretRight className="context-submenu-caret" />
      </button>
      {open && (
        <div
          className={`connection-context-menu context-submenu${parentX > window.innerWidth - 390 ? ' left' : ''}`}
        >
          {visibleChildren.map((child) =>
            child.label === '__separator__' ? (
              <span key={child.id} className="context-menu-divider" />
            ) : (
              <button
                key={child.id}
                type="button"
                disabled={child.disabled?.(menu)}
                onClick={() => void child.execute(menu, ctx)}
              >
                {child.icon && <child.icon weight={child.iconWeight} />}
                {child.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

export default function SidebarContextMenu({
  connectionGroups,
  expandedDatabases,
  onToggleConnectionFromMenu,
  onDatabaseClick,
  onAssignGroup,
  collapsedConnectionGroups,
  onExpandConnectionGroup,
  onCollapseConnectionGroup,
  onExpandAllGroups,
  onCollapseAllGroups,
  onRefreshConnections,
}: SidebarContextMenuProps) {
  const menu = useSidebarStore((s) => s.contextMenu)
  const sidebarActions = useSidebarStore((s) => s.actions)
  const connActions = useConnectionStore((s) => s.actions)
  const openSshTerminal = useTerminalTabsStore((s) => s.openSshTerminal)
  const createSshTerminal = useTerminalTabsStore((s) => s.createSshTerminal)
  const sshTerminalTabs = useTerminalTabsStore((s) => s.sshTerminalTabs)
  const closeSshTerminal = useTerminalTabsStore((s) => s.closeSshTerminal)
  const addQueryTab = useQueryTabsStore((s) => s.addQueryTab)
  const openTableData = useTableDataTabsStore((s) => s.openTableData)
  const designTable = useTableDesignerTabsStore((s) => s.designTable)
  const openTableDesigner = useTableDesignerTabsStore((s) => s.openTableDesigner)
  const dialogActions = useDialogStore((s) => s.actions)
  const tableOps = useTableOperations()
  const { confirm, confirmDialog } = useConfirmDialog()
  const { showToast } = useToast()

  if (!menu) return null

  const close = (): void => sidebarActions.setContextMenu(null)
  const clampX = (x: number): number => Math.min(x, window.innerWidth - 196)

  // 构建命令上下文
  const ctx: CommandContext = {
    close,
    clampX,
    onToggleConnectionFromMenu,
    onDatabaseClick,
    onAssignGroup,
    collapsedConnectionGroups,
    onExpandConnectionGroup,
    onCollapseConnectionGroup,
    onExpandAllGroups,
    onCollapseAllGroups,
    onRefreshConnections,
    connActions,
    dialogActions,
    sidebarActions,
    tableOps,
    addQueryTab,
    openTableData,
    designTable,
    openTableDesigner,
    openSshTerminal,
    createSshTerminal,
    closeSshTerminal,
    sshTerminalTabs,
    expandedDatabases,
    connectionGroups,
    confirm,
    showToast,
  }

  // 获取当前 kind 对应的命令列表
  const commands = getCommandsForKind(menu.kind, ctx)

  // 过滤可见命令
  const visibleCommands = commands.filter((cmd) => cmd.visible?.(menu) !== false)

  // 计算连接开关按钮的动态标签
  const getConnToggleLabel = (): string => {
    if (menu.kind !== 'connection') return ''
    if (menu.connection.engine === 'SSH') return ''
    return menu.connection.open ? '关闭连接' : '打开连接'
  }

  // 计算 object 查询按钮的动态标签
  const getObjQueryLabel = (): string => {
    if (menu.kind !== 'object') return ''
    return `查询${menu.groupLabel}`
  }

  // 计算 object 删除按钮的动态标签
  const getObjDeleteLabel = (): string => {
    if (menu.kind !== 'object') return ''
    return `删除${menu.groupLabel}`
  }

  // 计算 objectGroup 新建按钮的动态标签
  const getOgroupNewLabel = (): string => {
    if (menu.kind !== 'objectGroup') return ''
    return `新建${menu.groupLabel}`
  }

  // 动态标签映射
  const dynamicLabels: Record<string, () => string> = {
    'conn-toggle': getConnToggleLabel,
    'obj-query': getObjQueryLabel,
    'obj-delete': getObjDeleteLabel,
    'ogroup-new': getOgroupNewLabel,
  }

  /** 渲染单个菜单命令 */
  const renderCommand = (cmd: MenuCommand): React.ReactNode => {
    // 分隔线
    if (cmd.label === '__separator__') {
      return <span key={cmd.id} className="context-menu-divider" />
    }

    // 计算实际标签
    const labelFn = dynamicLabels[cmd.id]
    const actualLabel = labelFn ? labelFn() : cmd.label

    // 子菜单
    if (cmd.children) {
      return <SubMenu key={cmd.id} command={{ ...cmd, label: actualLabel }} menu={menu} ctx={ctx} parentX={menu.x} />
    }

    // 危险操作包裹
    const btn = (
      <button
        key={cmd.id}
        type="button"
        className={cmd.danger ? 'danger' : undefined}
        disabled={cmd.disabled?.(menu)}
        onClick={() => void cmd.execute(menu, ctx)}
      >
        {cmd.icon && <cmd.icon weight={cmd.iconWeight} />}
        {actualLabel}
      </button>
    )

    return btn
  }

  // 检查是否有危险区域（连续的危险命令需要包裹在 danger-zone 中）
  const renderCommands = (): React.ReactNode[] => {
    const elements: React.ReactNode[] = []
    let dangerBuffer: React.ReactNode[] = []

    const flushDanger = (): void => {
      if (dangerBuffer.length > 0) {
        elements.push(
          <div key={`danger-${elements.length}`} className="context-menu-danger-zone">
            {dangerBuffer}
          </div>
        )
        dangerBuffer = []
      }
    }

    for (const cmd of visibleCommands) {
      if (cmd.danger) {
        dangerBuffer.push(renderCommand(cmd))
      } else {
        flushDanger()
        elements.push(renderCommand(cmd))
      }
    }
    flushDanger()
    return elements
  }

  return createPortal(
    <>
      <div
        className="connection-context-menu"
        style={{ left: menu.x, top: menu.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {renderCommands()}
      </div>
      {confirmDialog}
      {tableOps.confirmDialog}
    </>,
    document.body
  )
}
