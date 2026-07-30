import {
  ArrowsClockwise,
  Code,
  Copy,
  Plus
} from '@phosphor-icons/react'
import { qualifiedName, getEngineCapabilities } from '../../../../shared/engine-capabilities'
import type { MenuCommand, CommandContext } from './command-registry'

export function getSchemaCommands(_ctx: CommandContext): MenuCommand[] {
  return [
    // ── 复制名称 ──
    {
      id: 'schema-copy-name',
      label: '复制名称',
      icon: Copy,
      visible: (menu) => menu.kind === 'schema',
      execute: (menu, c) => {
        if (menu.kind !== 'schema') return
        void navigator.clipboard.writeText(menu.schema.name)
        c.close()
      },
    },
    // ── 复制全限定名称 ──
    {
      id: 'schema-copy-qualified',
      label: '复制全限定名称',
      icon: Copy,
      visible: (menu) => menu.kind === 'schema',
      execute: (menu, c) => {
        if (menu.kind !== 'schema') return
        const engine = menu.connection.engine
        void navigator.clipboard.writeText(
          qualifiedName(engine, { database: menu.database.name, name: menu.schema.name })
        )
        c.close()
      },
    },
    // ── 新建查询 ──
    {
      id: 'schema-new-query',
      label: '新建查询',
      icon: Code,
      visible: (menu) => menu.kind === 'schema',
      execute: (menu, c) => {
        if (menu.kind !== 'schema') return
        c.addQueryTab({
          connectionId: menu.connection.id,
          connectionName: menu.connection.name,
          databaseName: menu.database.name,
          title: `查询 · ${menu.schema.name}`,
        })
        c.close()
      },
    },
    // ── 刷新 Schema ──
    {
      id: 'schema-refresh',
      label: '刷新 Schema',
      icon: ArrowsClockwise,
      visible: (menu) => menu.kind === 'schema',
      execute: (menu, c) => {
        if (menu.kind !== 'schema') return
        void c.connActions.refreshDatabase(menu.connection.id, menu.database.name)
        c.close()
      },
    },
    // ── 新建对象（子菜单，按能力矩阵） ──
    {
      id: 'schema-new-object',
      label: '新建对象',
      icon: Plus,
      visible: (menu) => {
        if (menu.kind !== 'schema') return false
        const caps = getEngineCapabilities(menu.connection.engine)
        return !!caps
      },
      children: (menu) => {
        if (menu.kind !== 'schema') return []
        const engine = menu.connection.engine
        const caps = getEngineCapabilities(engine)
        if (!caps) return []

        const labelMap: Record<string, string> = {
          tables: '数据表',
          views: '视图',
          functions: '函数',
          procedures: '存储过程',
        }

        return caps.objectTypes
          .filter((t) => ['tables', 'views', 'functions', 'procedures'].includes(t))
          .map((objType) => ({
            id: `schema-new-${objType}`,
            label: `新建${labelMap[objType] || objType}`,
            icon: Plus,
            execute: (m: any, c: CommandContext) => {
              if (m.kind !== 'schema') return
              if (objType === 'tables') {
                c.openTableDesigner(m.connection, m.database)
              } else {
                c.addQueryTab({
                  connectionId: m.connection.id,
                  connectionName: m.connection.name,
                  databaseName: m.database.name,
                  title: `新建${labelMap[objType]}`,
                  initialSql:
                    objType === 'views'
                      ? 'CREATE VIEW new_view AS\nSELECT 1;'
                      : `CREATE ${objType === 'functions' ? 'FUNCTION' : 'PROCEDURE'} new_${objType === 'functions' ? 'function' : 'procedure'}()\nBEGIN\n  -- SQL statements\nEND;`,
                })
              }
              c.close()
            },
          }))
      },
      execute: () => {},
    },
  ]
}
