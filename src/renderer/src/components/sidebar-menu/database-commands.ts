import {
  ArrowsClockwise,
  Broom,
  Code,
  DownloadSimple,
  FileCode,
  FileSql,
  PencilSimple,
  Plus,
  Power,
  Trash
} from '@phosphor-icons/react'
import type { MenuCommand, CommandContext } from './command-registry'

export function getDatabaseCommands(_ctx: CommandContext): MenuCommand[] {
  return [
    // ── 打开/收起 ──
    {
      id: 'db-toggle',
      label: '',
      icon: Power,
      visible: (menu) => menu.kind === 'database',
      execute: (menu, c) => {
        if (menu.kind !== 'database') return
        void c.onDatabaseClick(menu.databaseKey, menu.connection, menu.database)
        c.close()
      },
    },
    // ── 新建数据表 ──
    {
      id: 'db-new-table',
      label: '新建数据表',
      icon: Plus,
      execute: (menu, c) => {
        if (menu.kind !== 'database') return
        c.openTableDesigner(menu.connection, menu.database)
        c.close()
      },
    },
    // ── 新建数据库（非 SQLite） ──
    {
      id: 'db-new-db',
      label: '新建数据库',
      icon: Plus,
      visible: (menu) => menu.kind === 'database' && menu.connection.engine !== 'SQLite',
      execute: (menu, c) => {
        if (menu.kind !== 'database') return
        c.dialogActions.setDatabaseDialog({ connection: menu.connection, database: null })
        c.close()
      },
    },
    // ── 编辑数据库（非 SQLite） ──
    {
      id: 'db-edit',
      label: '编辑数据库',
      icon: PencilSimple,
      visible: (menu) => menu.kind === 'database' && menu.connection.engine !== 'SQLite',
      execute: (menu, c) => {
        if (menu.kind !== 'database') return
        c.dialogActions.setDatabaseDialog({ connection: menu.connection, database: menu.database })
        c.close()
      },
    },
    // ── 刷新 ──
    {
      id: 'db-refresh',
      label: '刷新数据库',
      icon: ArrowsClockwise,
      execute: (menu, c) => {
        if (menu.kind !== 'database') return
        void c.connActions.refreshDatabase(menu.connection.id, menu.database.name)
        c.close()
      },
    },
    // ── 新建查询 ──
    {
      id: 'db-new-query',
      label: '新建查询',
      icon: Code,
      execute: (menu, c) => {
        if (menu.kind !== 'database') return
        c.addQueryTab({
          connectionId: menu.connection.id,
          connectionName: menu.connection.name,
          databaseName: menu.database.name,
        })
        c.close()
      },
    },
    // ── 生成数据字典 ──
    {
      id: 'db-dict',
      label: '生成数据字典（Markdown）',
      icon: FileCode,
      execute: (menu, c) => {
        if (menu.kind !== 'database') return
        c.tableOps.handleExportDataDictionary(menu.connection, menu.database)
        c.close()
      },
    },
    // ── 运行 SQL 文件 ──
    {
      id: 'db-run-sql',
      label: '运行 SQL 文件',
      icon: FileSql,
      execute: (menu, c) => {
        if (menu.kind !== 'database') return
        void c.connActions.runDatabaseSqlFile(menu.connection, menu.database)
        c.close()
      },
    },
    // ── 导出 SQL（子菜单） ──
    {
      id: 'db-export',
      label: '导出 SQL',
      icon: DownloadSimple,
      children: () => [
        {
          id: 'db-export-structure',
          label: '仅导出结构',
          icon: DownloadSimple,
          execute: (menu, c) => {
            if (menu.kind !== 'database') return
            c.dialogActions.setExportSqlPreviewDialog({
              connection: menu.connection,
              database: menu.database,
              includeData: false,
            })
            c.close()
          },
        },
        {
          id: 'db-export-all',
          label: '导出结构和数据',
          icon: DownloadSimple,
          iconWeight: 'fill',
          execute: (menu, c) => {
            if (menu.kind !== 'database') return
            c.dialogActions.setExportSqlPreviewDialog({
              connection: menu.connection,
              database: menu.database,
              includeData: true,
            })
            c.close()
          },
        },
      ],
      execute: () => {},
    },
    // ── 分隔线 ──
    {
      id: 'db-sep-1',
      label: '__separator__',
      visible: () => true,
      execute: () => {},
    },
    // ── 危险操作区 ──
    {
      id: 'db-truncate-all',
      label: '清空全库所有表数据',
      icon: Broom,
      danger: true,
      execute: async (menu, c) => {
        if (menu.kind !== 'database') return
        const { connection, database } = menu
        const confirmed = await c.confirm({
          title: '⚠️ 极高风险操作：清空全库表数据',
          message: `确定要清空数据库【${database.name}】中的所有数据表记录吗？`,
          detail: `注意：数据库"${database.name}"中全库所有表中的所有数据行都将被擦除！此操作不可撤销恢复！`,
          confirmLabel: '确认清空全库所有数据',
        })
        c.close()
        if (confirmed) {
          for (const tbl of database.tables) {
            await window.omnidb.tables.truncate(connection.id, database.name, tbl.name)
          }
          await c.connActions.refreshConnection(connection.id)
        }
      },
    },
    {
      id: 'db-drop',
      label: '删除数据库（DROP DATABASE）',
      icon: Trash,
      danger: true,
      visible: (menu) => menu.kind === 'database' && menu.connection.engine !== 'SQLite',
      execute: async (menu, c) => {
        if (menu.kind !== 'database') return
        const { connection, database } = menu
        const confirmed = await c.confirm({
          title: '⚠️ 极高风险操作：删除数据库',
          message: `确定要删除数据库【${database.name}】吗？`,
          detail: `数据库 "${database.name}" 及其下所有表和数据都将被永久销毁，此操作不可撤销！`,
          confirmLabel: '确认销毁数据库',
        })
        c.close()
        if (confirmed) {
          await c.connActions.deleteDatabase(connection, database)
        }
      },
    },
  ]
}
