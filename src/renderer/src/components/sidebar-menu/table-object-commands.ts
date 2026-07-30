import {
  Code,
  Copy,
  DownloadSimple,
  PencilSimple,
  Plus,
  UploadSimple
} from '@phosphor-icons/react'
import { getQuoteChar } from '../../../../shared/engine-capabilities'
import type { MenuCommand, CommandContext } from './command-registry'

/**
 * tableGroup 节点命令
 */
export function getTableGroupCommands(_ctx: CommandContext): MenuCommand[] {
  return [
    {
      id: 'tg-new-table',
      label: '新建数据表',
      icon: Plus,
      visible: (menu) => menu.kind === 'tableGroup',
      execute: (menu, c) => {
        if (menu.kind !== 'tableGroup') return
        c.openTableDesigner(menu.connection, menu.database)
        c.close()
      },
    },
    {
      id: 'tg-import',
      label: '导入表数据…',
      icon: UploadSimple,
      visible: (menu) => menu.kind === 'tableGroup',
      execute: (menu, c) => {
        if (menu.kind !== 'tableGroup') return
        c.dialogActions.setTablePicker({ connection: menu.connection, database: menu.database, mode: 'import' })
        c.close()
      },
    },
    {
      id: 'tg-export',
      label: '导出表数据…',
      icon: DownloadSimple,
      visible: (menu) => menu.kind === 'tableGroup',
      execute: (menu, c) => {
        if (menu.kind !== 'tableGroup') return
        c.dialogActions.setTablePicker({ connection: menu.connection, database: menu.database, mode: 'export' })
        c.close()
      },
    },
  ]
}

/**
 * column 字段节点命令
 */
export function getColumnCommands(_ctx: CommandContext): MenuCommand[] {
  return [
    // ── 复制字段名 ──
    {
      id: 'col-copy-name',
      label: '复制字段名',
      icon: Copy,
      visible: (menu) => menu.kind === 'column',
      execute: (menu, c) => {
        if (menu.kind !== 'column') return
        void navigator.clipboard.writeText(menu.column)
        c.close()
      },
    },
    // ── 复制带引号字段名 ──
    {
      id: 'col-copy-quoted',
      label: '复制带引号字段名',
      icon: Copy,
      visible: (menu) => menu.kind === 'column',
      execute: (menu, c) => {
        if (menu.kind !== 'column') return
        const engine = menu.connection.engine
        const q = getQuoteChar(engine)
        const quotedCol = `${q}${menu.column}${q}`
        void navigator.clipboard.writeText(quotedCol)
        c.close()
      },
    },
    // ── 分隔线 ──
    {
      id: 'col-sep-1',
      label: '__separator__',
      visible: () => true,
      execute: () => {},
    },
    // ── 添加到 SELECT ──
    {
      id: 'col-add-select',
      label: '添加到 SELECT',
      icon: Code,
      visible: (menu) => menu.kind === 'column',
      execute: (menu, c) => {
        if (menu.kind !== 'column') return
        const engine = menu.connection.engine
        const q = getQuoteChar(engine)
        const quotedCol = `${q}${menu.column}${q}`
        void navigator.clipboard.writeText(quotedCol)
        c.close()
      },
    },
    // ── 添加到 WHERE ──
    {
      id: 'col-add-where',
      label: '添加到 WHERE',
      icon: Code,
      visible: (menu) => menu.kind === 'column',
      execute: (menu, c) => {
        if (menu.kind !== 'column') return
        const engine = menu.connection.engine
        const q = getQuoteChar(engine)
        const quotedCol = `${q}${menu.column}${q}`
        void navigator.clipboard.writeText(`WHERE ${quotedCol} = `)
        c.close()
      },
    },
    // ── 添加到 ORDER BY ──
    {
      id: 'col-add-orderby',
      label: '添加到 ORDER BY',
      icon: Code,
      visible: (menu) => menu.kind === 'column',
      execute: (menu, c) => {
        if (menu.kind !== 'column') return
        const engine = menu.connection.engine
        const q = getQuoteChar(engine)
        const quotedCol = `${q}${menu.column}${q}`
        void navigator.clipboard.writeText(`ORDER BY ${quotedCol}`)
        c.close()
      },
    },
    // ── 添加到 GROUP BY ──
    {
      id: 'col-add-groupby',
      label: '添加到 GROUP BY',
      icon: Code,
      visible: (menu) => menu.kind === 'column',
      execute: (menu, c) => {
        if (menu.kind !== 'column') return
        const engine = menu.connection.engine
        const q = getQuoteChar(engine)
        const quotedCol = `${q}${menu.column}${q}`
        void navigator.clipboard.writeText(`GROUP BY ${quotedCol}`)
        c.close()
      },
    },
    // ── 分隔线 ──
    {
      id: 'col-sep-2',
      label: '__separator__',
      visible: () => true,
      execute: () => {},
    },
    // ── 在表设计器中定位 ──
    {
      id: 'col-locate-designer',
      label: '在表设计器中定位',
      icon: PencilSimple,
      visible: (menu) => menu.kind === 'column',
      execute: (menu, c) => {
        if (menu.kind !== 'column') return
        c.designTable(menu.connection, menu.database, { name: menu.table } as any)
        c.close()
      },
    },
  ]
}
