import {
  ArrowsClockwise,
  Broom,
  Code,
  Copy,
  DownloadSimple,
  FileCode,
  FileSql,
  FolderOpen,
  Info,
  PencilSimple,
  Plus,
  Trash,
  Wrench
} from '@phosphor-icons/react'
import { qualifiedName } from '../../../../shared/engine-capabilities'
import type { MenuCommand, CommandContext } from './command-registry'

export function getTableCommands(_ctx: CommandContext): MenuCommand[] {
  const isMysqlMaintenance = (menu: any): boolean =>
    menu.kind === 'table' && ['MySQL', 'MariaDB', 'TiDB'].includes(menu.connection.engine)

  return [
    // ── 打开数据表 ──
    {
      id: 'table-open',
      label: '打开数据表',
      icon: FolderOpen,
      visible: (menu) => menu.kind === 'table',
      execute: (menu, c) => {
        if (menu.kind !== 'table') return
        c.openTableData(menu.connection, menu.database, menu.table)
        c.close()
      },
    },
    // ── 设计数据表 ──
    {
      id: 'table-design',
      label: '设计数据表',
      icon: PencilSimple,
      visible: (menu) => menu.kind === 'table',
      execute: (menu, c) => {
        if (menu.kind !== 'table') return
        c.designTable(menu.connection, menu.database, menu.table)
        c.close()
      },
    },
    // ── 新建数据表 ──
    {
      id: 'table-new',
      label: '新建数据表',
      icon: Plus,
      visible: (menu) => menu.kind === 'table',
      execute: (menu, c) => {
        if (menu.kind !== 'table') return
        c.openTableDesigner(menu.connection, menu.database)
        c.close()
      },
    },
    // ── 刷新数据表 ──
    {
      id: 'table-refresh',
      label: '刷新数据表',
      icon: ArrowsClockwise,
      visible: (menu) => menu.kind === 'table',
      execute: (menu, c) => {
        if (menu.kind !== 'table') return
        void c.connActions.refreshTable(menu.connection.id, menu.database.name, menu.table.name)
        c.close()
      },
    },
    // ── 分隔线 ──
    {
      id: 'table-sep-1',
      label: '__separator__',
      visible: () => true,
      execute: () => {},
    },
    // ── 复制数据表（子菜单） ──
    {
      id: 'table-copy',
      label: '复制数据表',
      icon: Copy,
      visible: (menu) => menu.kind === 'table',
      children: () => [
        {
          id: 'table-copy-structure',
          label: '仅复制结构',
          icon: Copy,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            void c.tableOps.handleCopyTable(menu.connection, menu.database, menu.table, false)
            c.close()
          },
        },
        {
          id: 'table-copy-all',
          label: '复制结构和数据',
          icon: Copy,
          iconWeight: 'fill',
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            void c.tableOps.handleCopyTable(menu.connection, menu.database, menu.table, true)
            c.close()
          },
        },
      ],
      execute: () => {},
    },
    // ── 复制数据表名称 ──
    {
      id: 'table-copy-name',
      label: '复制数据表名称',
      icon: Copy,
      visible: (menu) => menu.kind === 'table',
      execute: (menu, c) => {
        if (menu.kind !== 'table') return
        void navigator.clipboard.writeText(menu.table.name)
        c.close()
      },
    },
    // ── 复制全限定名称 ──
    {
      id: 'table-copy-qualified',
      label: '复制全限定名称',
      icon: Copy,
      visible: (menu) => menu.kind === 'table',
      execute: (menu, c) => {
        if (menu.kind !== 'table') return
        void navigator.clipboard.writeText(
          qualifiedName(menu.connection.engine, {
            database: menu.database.name,
            schema: menu.schemaName,
            name: menu.table.name,
          })
        )
        c.close()
      },
    },
    // ── 生成 SQL（子菜单） ──
    {
      id: 'table-gen-sql',
      label: '生成 SQL',
      icon: FileCode,
      visible: (menu) => menu.kind === 'table',
      children: () => [
        {
          id: 'table-gen-select',
          label: '生成 SELECT 语句',
          icon: Code,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'select', menu.schemaName)
            c.close()
          },
        },
        {
          id: 'table-gen-insert',
          label: '生成 INSERT 模板',
          icon: Plus,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'insert', menu.schemaName)
            c.close()
          },
        },
        {
          id: 'table-gen-update',
          label: '生成 UPDATE 模板',
          icon: PencilSimple,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'update', menu.schemaName)
            c.close()
          },
        },
        {
          id: 'table-gen-delete',
          label: '生成 DELETE 模板',
          icon: Trash,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'delete', menu.schemaName)
            c.close()
          },
        },
        {
          id: 'table-gen-sql-sep',
          label: '__separator__',
          visible: () => true,
          execute: () => {},
        },
        {
          id: 'table-gen-ddl',
          label: '查看表结构',
          icon: FileSql,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.tableOps.handleGenerateSql(menu.connection, menu.database, menu.table, 'ddl', menu.schemaName)
            c.close()
          },
        },
      ],
      execute: () => {},
    },
    // ── 导出 SQL / 表数据（子菜单） ──
    {
      id: 'table-export',
      label: '导出 SQL / 表数据',
      icon: DownloadSimple,
      visible: (menu) => menu.kind === 'table',
      children: () => [
        {
          id: 'table-export-structure',
          label: '仅导出结构 (.sql)',
          icon: DownloadSimple,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.dialogActions.setExportSqlPreviewDialog({
              connection: menu.connection,
              database: menu.database,
              table: menu.table,
              includeData: false,
            })
            c.close()
          },
        },
        {
          id: 'table-export-all',
          label: '导出结构和数据 (.sql)',
          icon: DownloadSimple,
          iconWeight: 'fill',
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.dialogActions.setExportSqlPreviewDialog({
              connection: menu.connection,
              database: menu.database,
              table: menu.table,
              includeData: true,
            })
            c.close()
          },
        },
        {
          id: 'table-export-sep',
          label: '__separator__',
          visible: () => true,
          execute: () => {},
        },
        {
          id: 'table-export-data',
          label: '导出表数据…',
          icon: DownloadSimple,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            void c.tableOps.handleExportTable(menu.connection, menu.database, menu.table)
            c.close()
          },
        },
      ],
      execute: () => {},
    },
    // ── 表维护工具（子菜单，仅 MySQL 家族） ──
    {
      id: 'table-maintenance',
      label: '表维护工具',
      icon: Wrench,
      visible: isMysqlMaintenance,
      children: () => [
        {
          id: 'table-maint-check',
          label: '检查表 (CHECK TABLE)',
          icon: Wrench,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.tableOps.handleMaintainTable(menu.connection, menu.database, menu.table, 'check', menu.schemaName)
            c.close()
          },
        },
        {
          id: 'table-maint-optimize',
          label: '优化表 (OPTIMIZE TABLE)',
          icon: Broom,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.tableOps.handleMaintainTable(menu.connection, menu.database, menu.table, 'optimize', menu.schemaName)
            c.close()
          },
        },
        {
          id: 'table-maint-analyze',
          label: '分析表 (ANALYZE TABLE)',
          icon: ArrowsClockwise,
          execute: (menu, c) => {
            if (menu.kind !== 'table') return
            c.tableOps.handleMaintainTable(menu.connection, menu.database, menu.table, 'analyze', menu.schemaName)
            c.close()
          },
        },
      ],
      execute: () => {},
    },
    // ── 查看数据表信息 ──
    {
      id: 'table-info',
      label: '查看数据表信息',
      icon: Info,
      visible: (menu) => menu.kind === 'table',
      execute: (menu, c) => {
        if (menu.kind !== 'table') return
        c.dialogActions.openTableInfoDialog(menu.connection, menu.database, menu.table)
        c.close()
      },
    },
    // ── 重命名数据表 ──
    {
      id: 'table-rename',
      label: '重命名数据表',
      icon: PencilSimple,
      visible: (menu) => menu.kind === 'table',
      execute: (menu, c) => {
        if (menu.kind !== 'table') return
        c.dialogActions.openRenameTableDialog(menu.connection, menu.database, menu.table)
        c.close()
      },
    },
    // ── 分隔线 ──
    {
      id: 'table-sep-2',
      label: '__separator__',
      visible: () => true,
      execute: () => {},
    },
    // ── 危险操作区 ──
    {
      id: 'table-truncate',
      label: '清空表数据（TRUNCATE）',
      icon: Broom,
      danger: true,
      visible: (menu) => menu.kind === 'table',
      execute: async (menu, c) => {
        if (menu.kind !== 'table') return
        const { connection, database, table } = menu
        await c.tableOps.handleTruncateTable(connection, database, table)
        c.close()
      },
    },
    {
      id: 'table-drop',
      label: '删除数据表（DROP TABLE）',
      icon: Trash,
      danger: true,
      visible: (menu) => menu.kind === 'table',
      execute: async (menu, c) => {
        if (menu.kind !== 'table') return
        const { connection, database, table } = menu
        await c.tableOps.handleDeleteTable(connection, database, table)
        c.close()
      },
    },
  ]
}
