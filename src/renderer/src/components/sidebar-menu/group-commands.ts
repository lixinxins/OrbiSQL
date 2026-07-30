import {
  CaretDown,
  CaretRight,
  PencilSimple,
  Plus,
  Trash
} from '@phosphor-icons/react'
import type { MenuCommand, CommandContext } from './command-registry'

export function getConnectionGroupCommands(ctx: CommandContext): MenuCommand[] {
  return [
    // ── 新建连接 ──
    {
      id: 'cgroup-new-conn',
      label: '新建连接',
      icon: Plus,
      visible: (menu) => menu.kind === 'connectionGroup',
      execute: (_menu, c) => {
        c.dialogActions.setEditingConnection(null)
        c.dialogActions.setShowConnectionDialog(true)
        c.close()
      },
    },
    // ── 重命名分组 ──
    {
      id: 'cgroup-rename',
      label: '重命名分组',
      icon: PencilSimple,
      visible: (menu) => menu.kind === 'connectionGroup',
      execute: async (menu, c) => {
        if (menu.kind !== 'connectionGroup') return
        const group = menu.group
        const newName = window.prompt('重命名分组', group.name)
        if (newName && newName.trim() && newName.trim() !== group.name) {
          const result = await window.omnidb.connections.renameGroup(group.id, newName.trim())
          if (!result.success) c.showToast('error', result.message)
        }
        c.close()
      },
    },
    // ── 展开当前分组 ──
    {
      id: 'cgroup-expand-all',
      label: '展开分组',
      icon: CaretDown,
      visible: (menu) =>
        menu.kind === 'connectionGroup' && ctx.collapsedConnectionGroups.has(menu.group.id),
      execute: (menu, c) => {
        if (menu.kind !== 'connectionGroup') return
        c.onExpandConnectionGroup(menu.group.id)
        c.close()
      },
    },
    // ── 收起当前分组 ──
    {
      id: 'cgroup-collapse-all',
      label: '收起分组',
      icon: CaretRight,
      visible: (menu) =>
        menu.kind === 'connectionGroup' && !ctx.collapsedConnectionGroups.has(menu.group.id),
      execute: (menu, c) => {
        if (menu.kind !== 'connectionGroup') return
        c.onCollapseConnectionGroup(menu.group.id)
        c.close()
      },
    },
    // ── 分隔线 ──
    {
      id: 'cgroup-sep-1',
      label: '__separator__',
      visible: () => true,
      execute: () => {},
    },
    // ── 删除分组 ──
    {
      id: 'cgroup-delete',
      label: '删除分组',
      icon: Trash,
      danger: true,
      visible: (menu) => menu.kind === 'connectionGroup',
      execute: async (menu, c) => {
        if (menu.kind !== 'connectionGroup') return
        const group = menu.group
        const confirmed = await c.confirm({
          title: '删除分组',
          message: `确定要删除分组【${group.name}】吗？`,
          detail: '分组内的连接将移至"未分组"，此操作不可撤销。',
          confirmLabel: '确认删除分组',
        })
        c.close()
        if (confirmed) {
          await window.omnidb.connections.deleteGroup(group.id)
          c.onRefreshConnections?.()
        }
      },
    },
  ]
}
