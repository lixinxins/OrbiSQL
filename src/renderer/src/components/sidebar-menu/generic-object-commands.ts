import {
  ArrowsClockwise,
  Code,
  Copy,
  FileCode,
  PencilSimple,
  Plus,
  Trash
} from '@phosphor-icons/react'
import { getQuoteChar, qualifiedName, getEngineCapabilities } from '../../../../shared/engine-capabilities'
import type { MenuCommand, CommandContext } from './command-registry'

/**
 * object 节点命令（视图/存储过程/函数/触发器）
 */
export function getObjectCommands(_ctx: CommandContext): MenuCommand[] {
  return [
    // ── 查询对象 ──
    {
      id: 'obj-query',
      label: '',
      icon: Code,
      visible: (menu) => menu.kind === 'object',
      execute: (menu, c) => {
        if (menu.kind !== 'object') return
        const engine = menu.connection.engine
        const q = getQuoteChar(engine)
        const schemaPrefix = menu.schemaName ? `${q}${menu.schemaName}${q}.` : ''
        const quotedObj = `${schemaPrefix}${q}${menu.objectName}${q}`
        c.addQueryTab({
          connectionId: menu.connection.id,
          connectionName: menu.connection.name,
          databaseName: menu.database.name,
          title: `查询 · ${menu.objectName}`,
          initialSql: `SELECT * FROM ${quotedObj} LIMIT 100;`,
          autoRun: true,
        })
        c.close()
      },
    },
    // ── 查看定义 DDL ──
    {
      id: 'obj-ddl',
      label: '查看定义 DDL',
      icon: FileCode,
      visible: (menu) => {
        if (menu.kind !== 'object') return false
        const typeMap: Record<string, string> = {
          views: 'VIEW',
          procedures: 'PROCEDURE',
          functions: 'FUNCTION',
          triggers: 'TRIGGER',
        }
        return !!typeMap[menu.groupKey]
      },
      execute: (menu, c) => {
        if (menu.kind !== 'object') return
        const engine = menu.connection.engine
        const q = getQuoteChar(engine)
        const schemaPrefix = menu.schemaName ? `${q}${menu.schemaName}${q}.` : ''
        const quotedObj = `${schemaPrefix}${q}${menu.objectName}${q}`
        const typeMap: Record<string, string> = {
          views: 'VIEW',
          procedures: 'PROCEDURE',
          functions: 'FUNCTION',
          triggers: 'TRIGGER',
        }
        const objectType = typeMap[menu.groupKey]
        if (!objectType) return

        const caps = getEngineCapabilities(engine)
        const isMysqlFamily = ['MySQL', 'MariaDB', 'TiDB'].includes(engine)
        const isPg = engine.toLowerCase() === 'postgresql'
        const isSqlite = engine.toLowerCase() === 'sqlite'

        let sql: string | null = null
        if (isMysqlFamily) {
          sql = `SHOW CREATE ${objectType} ${quotedObj};`
        } else if (isPg) {
          if (objectType === 'VIEW') {
            sql = `SELECT pg_get_viewdef('${menu.schemaName ? `${menu.schemaName}.${menu.objectName}` : menu.objectName}', true);`
          } else {
            sql = `SELECT * FROM information_schema.routines WHERE routine_name = '${menu.objectName}'${menu.schemaName ? ` AND routine_schema = '${menu.schemaName}'` : ''};`
          }
        } else if (isSqlite) {
          sql = `SELECT sql FROM sqlite_master WHERE name = '${menu.objectName}';`
        } else if (caps) {
          sql = `SELECT * FROM information_schema.routines WHERE routine_name = '${menu.objectName}'${menu.schemaName ? ` AND routine_schema = '${menu.schemaName}'` : ''};`
        }

        if (sql) {
          c.addQueryTab({
            connectionId: menu.connection.id,
            connectionName: menu.connection.name,
            databaseName: menu.database.name,
            title: `DDL · ${menu.objectName}`,
            initialSql: sql,
            autoRun: true,
          })
          c.close()
        }
      },
    },
    // ── 可视化编辑存储过程 ──
    {
      id: 'obj-edit-routine',
      label: '可视化编辑存储过程',
      icon: PencilSimple,
      visible: (menu) => menu.kind === 'object' && menu.groupKey === 'procedures',
      execute: (_menu, c) => {
        c.dialogActions.setAdvancedTool({ mode: 'routine' })
        c.close()
      },
    },
    // ── 复制名称 ──
    {
      id: 'obj-copy-name',
      label: '复制名称',
      icon: Copy,
      visible: (menu) => menu.kind === 'object',
      execute: (menu, c) => {
        if (menu.kind !== 'object') return
        void navigator.clipboard.writeText(menu.objectName)
        c.close()
      },
    },
    // ── 复制全限定名称 ──
    {
      id: 'obj-copy-qualified',
      label: '复制全限定名称',
      icon: Copy,
      visible: (menu) => menu.kind === 'object',
      execute: (menu, c) => {
        if (menu.kind !== 'object') return
        const engine = menu.connection.engine
        void navigator.clipboard.writeText(
          qualifiedName(engine, {
            database: menu.database.name,
            schema: menu.schemaName,
            name: menu.objectName,
          })
        )
        c.close()
      },
    },
    // ── 刷新当前节点 ──
    {
      id: 'obj-refresh',
      label: '刷新当前节点',
      icon: ArrowsClockwise,
      visible: (menu) => menu.kind === 'object',
      execute: (menu, c) => {
        if (menu.kind !== 'object') return
        void c.connActions.refreshConnection(menu.connection.id)
        c.close()
      },
    },
    // ── 分隔线 ──
    {
      id: 'obj-sep-1',
      label: '__separator__',
      visible: (menu) => {
        if (menu.kind !== 'object') return false
        const typeMap: Record<string, string> = {
          views: 'VIEW',
          procedures: 'PROCEDURE',
          functions: 'FUNCTION',
          triggers: 'TRIGGER',
        }
        return !!typeMap[menu.groupKey]
      },
      execute: () => {},
    },
    // ── 删除对象 ──
    {
      id: 'obj-delete',
      label: '',
      icon: Trash,
      danger: true,
      visible: (menu) => {
        if (menu.kind !== 'object') return false
        const typeMap: Record<string, string> = {
          views: 'VIEW',
          procedures: 'PROCEDURE',
          functions: 'FUNCTION',
          triggers: 'TRIGGER',
        }
        return !!typeMap[menu.groupKey]
      },
      execute: async (menu, c) => {
        if (menu.kind !== 'object') return
        const { connection, database, groupLabel, objectName, groupKey, schemaName: sn } = menu
        const confirmed = await c.confirm({
          title: `删除${groupLabel}`,
          message: `确定要删除${groupLabel}【${objectName}】吗？`,
          detail: '此操作不可撤销。',
          confirmLabel: '删除对象',
        })
        c.close()
        if (confirmed) {
          const dq = getQuoteChar(connection.engine)
          const dropSchemaPrefix = sn ? `${dq}${sn}${dq}.` : ''
          const dropQuotedName = `${dropSchemaPrefix}${dq}${objectName}${dq}`
          const dropTypeMap: Record<string, string> = {
            views: 'VIEW',
            procedures: 'PROCEDURE',
            functions: 'FUNCTION',
            triggers: 'TRIGGER',
          }
          const dropObjectType = dropTypeMap[groupKey]
          if (!dropObjectType) return
          await window.omnidb.queries.execute(
            connection.id,
            database.name,
            `DROP ${dropObjectType} ${dropQuotedName};`
          )
          await c.connActions.refreshConnection(connection.id)
        }
      },
    },
  ]
}

/**
 * objectGroup 节点命令
 */
export function getObjectGroupCommands(_ctx: CommandContext): MenuCommand[] {
  return [
    // ── 新建对象 ──
    {
      id: 'ogroup-new',
      label: '',
      icon: Plus,
      visible: (menu) => menu.kind === 'objectGroup',
      execute: (menu, c) => {
        if (menu.kind !== 'objectGroup') return
        if (menu.groupKey === 'procedures' || menu.groupKey === 'functions') {
          c.dialogActions.setAdvancedTool({ mode: 'routine' })
        } else {
          c.addQueryTab({
            connectionId: menu.connection.id,
            connectionName: menu.connection.name,
            databaseName: menu.database.name,
            title: `新建${menu.groupLabel}`,
            initialSql:
              menu.groupKey === 'views'
                ? 'CREATE VIEW new_view AS\nSELECT 1;'
                : 'CREATE PROCEDURE new_procedure()\nBEGIN\n  -- SQL statements\nEND;',
          })
        }
        c.close()
      },
    },
    // ── 复制分类名称 ──
    {
      id: 'ogroup-copy-name',
      label: '复制分类名称',
      icon: Copy,
      visible: (menu) => menu.kind === 'objectGroup',
      execute: (menu, c) => {
        if (menu.kind !== 'objectGroup') return
        void navigator.clipboard.writeText(menu.groupLabel)
        c.close()
      },
    },
  ]
}
