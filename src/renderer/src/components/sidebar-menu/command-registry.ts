import type { ComponentType } from 'react'
import type { SidebarContextMenuState } from '../../stores/useSidebarStore'
import type { ConnectionGroup, DatabaseConnection } from '@/shared/connections'

// 从各个命令文件导入
import { getConnectionCommands } from './connection-commands'
import { getDatabaseCommands } from './database-commands'
import { getSchemaCommands } from './schema-commands'
import { getTableCommands } from './table-commands'
import { getTableGroupCommands, getColumnCommands } from './table-object-commands'
import { getObjectCommands, getObjectGroupCommands } from './generic-object-commands'
import { getConnectionGroupCommands } from './group-commands'
import { getSectionCommands, getSidebarBlankCommands } from './area-commands'

type ActiveSidebarContextMenuState = NonNullable<SidebarContextMenuState>

/**
 * 菜单命令上下文
 * 包含所有命令执行所需的回调和状态
 */
export interface CommandContext {
  // 关闭菜单
  close: () => void
  clampX: (x: number) => number

  // 连接操作回调
  onToggleConnectionFromMenu: (connection: DatabaseConnection) => Promise<void>
  onDatabaseClick: (databaseKey: string, connection: DatabaseConnection, database: any) => Promise<void>
  onAssignGroup: (connectionId: number, groupId: number | null) => Promise<void>
  collapsedConnectionGroups: Set<number>
  onExpandConnectionGroup: (groupId: number) => void
  onCollapseConnectionGroup: (groupId: number) => void
  onExpandAllGroups?: (category: 'database' | 'ssh') => void
  onCollapseAllGroups?: (category: 'database' | 'ssh') => void
  onRefreshConnections?: () => void

  // Store actions
  connActions: any
  dialogActions: any
  sidebarActions: any
  tableOps: any

  // Tab 创建
  addQueryTab: (options: any) => void
  openTableData: (connection: DatabaseConnection, database: any, table: any) => void
  designTable: (connection: DatabaseConnection, database: any, table: any) => void
  openTableDesigner: (connection: DatabaseConnection, database: any) => void

  // SSH 终端
  openSshTerminal: (connection: DatabaseConnection) => void
  createSshTerminal: (connection: DatabaseConnection) => void
  closeSshTerminal: (tabId: string) => void
  sshTerminalTabs: any[]

  // 状态
  expandedDatabases: Set<string>
  connectionGroups: ConnectionGroup[]

  // 确认对话框
  confirm: (options: {
    title: string
    message: string
    detail?: string
    confirmLabel?: string
  }) => Promise<boolean>

  // Toast 提示
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void
}

/**
 * 菜单命令定义
 */
export interface MenuCommand {
  id: string
  label: string
  icon?: ComponentType<any>
  iconWeight?: 'bold' | 'fill' | 'duotone' | 'light' | 'thin'
  /** 是否显示 */
  visible?: (menu: ActiveSidebarContextMenuState) => boolean
  /** 是否禁用 */
  disabled?: (menu: ActiveSidebarContextMenuState) => boolean
  /** 危险等级 */
  danger?: boolean
  /** 在该命令前显示分隔线 */
  separator?: boolean
  /** 子菜单命令 */
  children?: (menu: ActiveSidebarContextMenuState) => MenuCommand[]
  /** 执行函数 */
  execute: (menu: ActiveSidebarContextMenuState, ctx: CommandContext) => void | Promise<void>
}

/**
 * 根据菜单类型获取对应的命令列表
 */
export function getCommandsForKind(
  kind: ActiveSidebarContextMenuState['kind'],
  ctx: CommandContext
): MenuCommand[] {
  switch (kind) {
    case 'connection':
      return getConnectionCommands(ctx)
    case 'database':
      return getDatabaseCommands(ctx)
    case 'schema':
      return getSchemaCommands(ctx)
    case 'table':
      return getTableCommands(ctx)
    case 'tableGroup':
      return getTableGroupCommands(ctx)
    case 'column':
      return getColumnCommands(ctx)
    case 'object':
      return getObjectCommands(ctx)
    case 'objectGroup':
      return getObjectGroupCommands(ctx)
    case 'connectionGroup':
      return getConnectionGroupCommands(ctx)
    case 'section':
      return getSectionCommands(ctx)
    case 'sidebarBlank':
      return getSidebarBlankCommands(ctx)
    default:
      return []
  }
}
