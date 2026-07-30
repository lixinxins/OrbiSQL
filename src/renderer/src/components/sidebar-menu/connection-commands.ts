import {
  ArrowsClockwise,
  Copy,
  FileSql,
  FolderOpen,
  PencilSimple,
  Plus,
  Power,
  Rows,
  Trash,
  Wrench
} from '@phosphor-icons/react'
import type { MenuCommand, CommandContext } from './command-registry'

export function getConnectionCommands(ctx: CommandContext): MenuCommand[] {
  return [
    // ── SSH / 连接开关 ──
    {
      id: 'conn-toggle',
      label: '',
      icon: Power,
      visible: (menu) => {
        if (menu.kind !== 'connection') return false
        return menu.connection.engine !== 'SSH'
      },
      execute: (menu, c) => {
        if (menu.kind !== 'connection') return
        void c.onToggleConnectionFromMenu(menu.connection)
        c.close()
      },
      // label 动态计算 — 在组件层通过 getLabel 处理
    },
    {
      id: 'ssh-terminal-toggle',
      label: '',
      icon: Power,
      visible: (menu) => {
        if (menu.kind !== 'connection') return false
        if (menu.connection.engine !== 'SSH') return false
        const sshTab = ctx.sshTerminalTabs.find((t) => t.connection.id === menu.connection.id)
        return !sshTab
      },
      execute: (menu, c) => {
        if (menu.kind !== 'connection') return
        c.openSshTerminal(menu.connection)
        c.close()
      },
    },
    {
      id: 'ssh-terminal-create',
      label: '新建会话',
      icon: Plus,
      visible: (menu) => {
        if (menu.kind !== 'connection') return false
        if (menu.connection.engine !== 'SSH') return false
        const sshTab = ctx.sshTerminalTabs.find((t) => t.connection.id === menu.connection.id)
        return !!sshTab
      },
      execute: (menu, c) => {
        if (menu.kind !== 'connection') return
        c.createSshTerminal(menu.connection)
        c.close()
      },
    },
    {
      id: 'ssh-terminal-close',
      label: '关闭 SSH 终端',
      icon: Trash,
      danger: true,
      visible: (menu) => {
        if (menu.kind !== 'connection') return false
        if (menu.connection.engine !== 'SSH') return false
        const sshTab = ctx.sshTerminalTabs.find((t) => t.connection.id === menu.connection.id)
        return !!sshTab
      },
      execute: (menu, c) => {
        if (menu.kind !== 'connection') return
        const sshTab = ctx.sshTerminalTabs.find((t) => t.connection.id === menu.connection.id)
        if (sshTab) c.closeSshTerminal(sshTab.id)
        c.close()
      },
    },
    // ── 编辑 / 新建 / 复制 ──
    {
      id: 'conn-edit',
      label: '编辑连接',
      icon: PencilSimple,
      execute: (menu, c) => {
        if (menu.kind !== 'connection') return
        c.dialogActions.setEditingConnection(menu.connection)
        c.dialogActions.setShowConnectionDialog(true)
        c.close()
      },
    },
    {
      id: 'conn-new',
      label: '新建连接',
      icon: Plus,
      execute: (_menu, c) => {
        c.dialogActions.setEditingConnection(null)
        c.dialogActions.setShowConnectionDialog(true)
        c.close()
      },
    },
    {
      id: 'conn-duplicate',
      label: '复制连接配置',
      icon: Copy,
      execute: (menu, c) => {
        if (menu.kind !== 'connection') return
        void c.connActions.duplicateConnection(menu.connection)
        c.close()
      },
    },
    // ── 分隔线 ──
    {
      id: 'conn-sep-1',
      label: '__separator__',
      visible: () => true,
      execute: () => {},
    },
    // ── 移动到分组（子菜单） ──
    {
      id: 'conn-move-group',
      label: '移动到分组',
      icon: FolderOpen,
      children: (menu) => {
        if (menu.kind !== 'connection') return []
        const isSsh = menu.connection.engine === 'SSH'
        const filteredGroups = ctx.connectionGroups.filter(g =>
          isSsh ? g.category === 'ssh' : g.category === 'database'
        )
        const items: MenuCommand[] = [
          {
            id: 'conn-move-none',
            label: `${!menu.connection.groupId ? '✓ ' : ''}未分组`,
            execute: (m, c) => {
              if (m.kind !== 'connection') return
              void c.onAssignGroup(m.connection.id, null)
              c.close()
            },
          },
        ]
        for (const group of filteredGroups) {
          items.push({
            id: `conn-move-${group.id}`,
            label: `${menu.connection.groupId === group.id ? '✓ ' : ''}${group.name}`,
            execute: (_m, c) => {
              if (menu.kind !== 'connection') return
              void c.onAssignGroup(menu.connection.id, group.id)
              c.close()
            },
          })
        }
        if (!filteredGroups.length) {
          items.push({
            id: 'conn-move-empty',
            label: '请先在侧栏新建分组',
            disabled: () => true,
            execute: () => {},
          })
        }
        return items
      },
      execute: () => {},
    },
    // ── 刷新 ──
    {
      id: 'conn-refresh',
      label: '刷新连接信息',
      icon: ArrowsClockwise,
      execute: (menu, c) => {
        if (menu.kind !== 'connection') return
        void c.connActions.refreshConnection(menu.connection.id)
        void c.connActions.loadConnections()
        c.close()
      },
    },
    // ── 设置环境标签（子菜单） ──
    {
      id: 'conn-env',
      label: '设置环境标签',
      icon: Wrench,
      children: () => [
        {
          id: 'env-production',
          label: '🔴 生产环境 (PROD)',
          execute: (menu, c) => {
            if (menu.kind !== 'connection') return
            void c.connActions.setConnectionEnvironment(menu.connection, 'production', '#ef4444')
            c.close()
          },
        },
        {
          id: 'env-staging',
          label: '🟡 测试环境 (TEST)',
          execute: (menu, c) => {
            if (menu.kind !== 'connection') return
            void c.connActions.setConnectionEnvironment(menu.connection, 'staging', '#f59e0b')
            c.close()
          },
        },
        {
          id: 'env-development',
          label: '🟢 开发环境 (DEV)',
          execute: (menu, c) => {
            if (menu.kind !== 'connection') return
            void c.connActions.setConnectionEnvironment(menu.connection, 'development', '#10b981')
            c.close()
          },
        },
        {
          id: 'env-none',
          label: '🟣 无环境标签',
          execute: (menu, c) => {
            if (menu.kind !== 'connection') return
            void c.connActions.setConnectionEnvironment(menu.connection, null, '#6366f1')
            c.close()
          },
        },
      ],
      execute: () => {},
    },
    // ── 非 SSH 专有命令 ──
    {
      id: 'conn-process-list',
      label: '查看会话与进程',
      icon: Rows,
      visible: (menu) => {
        if (menu.kind !== 'connection') return false
        return menu.connection.engine !== 'SSH'
      },
      disabled: (menu) => {
        if (menu.kind !== 'connection') return true
        return !menu.connection.open
      },
      execute: (menu, c) => {
        if (menu.kind !== 'connection') return
        c.addQueryTab({
          connectionId: menu.connection.id,
          connectionName: menu.connection.name,
          databaseName: menu.connection.databases[0]?.name || '',
          title: `活动进程 · ${menu.connection.name}`,
          isProcessList: true,
        })
        c.close()
      },
    },
    {
      id: 'conn-run-sql',
      label: '运行 SQL 文件',
      icon: FileSql,
      visible: (menu) => {
        if (menu.kind !== 'connection') return false
        return menu.connection.engine !== 'SSH'
      },
      disabled: (menu) => {
        if (menu.kind !== 'connection') return true
        return !menu.connection.open
      },
      execute: (menu, c) => {
        if (menu.kind !== 'connection') return
        void c.connActions.runSqlFile(menu.connection)
        c.close()
      },
    },
    // ── 分隔线 ──
    {
      id: 'conn-sep-2',
      label: '__separator__',
      visible: () => true,
      execute: () => {},
    },
    // ── 危险操作 ──
    {
      id: 'conn-delete',
      label: '删除连接',
      icon: Trash,
      danger: true,
      execute: async (menu, c) => {
        if (menu.kind !== 'connection') return
        const conn = menu.connection
        const confirmed = await c.confirm({
          title: '⚠️ 危险操作：删除连接',
          message: `确定要删除连接【${conn.name}】吗？`,
          detail: '删除后该连接的所有配置信息将被彻底清除，此操作不可撤销。',
          confirmLabel: '确认删除连接',
        })
        c.close()
        if (confirmed) {
          await c.connActions.deleteConnection(conn)
        }
      },
    },
  ]
}
