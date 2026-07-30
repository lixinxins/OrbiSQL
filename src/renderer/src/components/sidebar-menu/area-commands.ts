import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  FolderPlus,
  Plus,
  UploadSimple
} from '@phosphor-icons/react'
import type { MenuCommand, CommandContext } from './command-registry'

/**
 * section 区域标题命令
 */
export function getSectionCommands(_ctx: CommandContext): MenuCommand[] {
  return [
    {
      id: 'section-new-conn',
      label: '新建连接',
      icon: Plus,
      visible: (menu) => menu.kind === 'section',
      execute: (_menu, c) => {
        c.dialogActions.setEditingConnection(null)
        c.dialogActions.setShowConnectionDialog(true)
        c.close()
      },
    },
    {
      id: 'section-new-group',
      label: '新建分组',
      icon: FolderPlus,
      visible: (menu) => menu.kind === 'section',
      execute: (_menu, c) => {
        c.dialogActions.setShowConnectionGroupDialog(true)
        c.close()
      },
    },
    {
      id: 'section-expand-all',
      label: '全部展开',
      icon: CaretDown,
      visible: (menu) => menu.kind === 'section',
      execute: (menu, c) => {
        if (menu.kind !== 'section') return
        c.onExpandAllGroups?.(menu.category)
        c.close()
      },
    },
    {
      id: 'section-collapse-all',
      label: '全部收起',
      icon: CaretRight,
      visible: (menu) => menu.kind === 'section',
      execute: (menu, c) => {
        if (menu.kind !== 'section') return
        c.onCollapseAllGroups?.(menu.category)
        c.close()
      },
    },
    {
      id: 'section-refresh',
      label: '刷新连接列表',
      icon: ArrowsClockwise,
      visible: (menu) => menu.kind === 'section',
      execute: (_menu, c) => {
        c.onRefreshConnections?.()
        c.close()
      },
    },
  ]
}

/**
 * sidebarBlank 侧边栏空白区域命令
 */
export function getSidebarBlankCommands(_ctx: CommandContext): MenuCommand[] {
  return [
    {
      id: 'blank-new-conn',
      label: '新建连接',
      icon: Plus,
      visible: (menu) => menu.kind === 'sidebarBlank',
      execute: (_menu, c) => {
        c.dialogActions.setEditingConnection(null)
        c.dialogActions.setShowConnectionDialog(true)
        c.close()
      },
    },
    {
      id: 'blank-new-group',
      label: '新建分组',
      icon: FolderPlus,
      visible: (menu) => menu.kind === 'sidebarBlank',
      execute: (_menu, c) => {
        c.dialogActions.setShowConnectionGroupDialog(true)
        c.close()
      },
    },
    {
      id: 'blank-import',
      label: '导入连接配置',
      icon: UploadSimple,
      visible: (menu) => menu.kind === 'sidebarBlank',
      execute: async (_menu, c) => {
        const preview = await window.omnidb.connections.readImportConfigFile()
        if (!preview.success) {
          if (preview.message !== '已取消导入') c.showToast('error', preview.message)
          c.close()
          return
        }
        const result = await window.omnidb.connections.importConfig({
          filePath: preview.filePath,
          groups: preview.groups,
          connections: preview.connections,
        })
        if (result.success) c.showToast('success', result.message)
        else c.showToast('error', result.message)
        c.onRefreshConnections?.()
        c.close()
      },
    },
    {
      id: 'blank-collapse-all',
      label: '全部折叠',
      icon: CaretRight,
      visible: (menu) => menu.kind === 'sidebarBlank',
      execute: (_menu, c) => {
        c.onCollapseAllGroups?.('database')
        c.onCollapseAllGroups?.('ssh')
        c.close()
      },
    },
  ]
}
