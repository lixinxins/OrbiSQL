import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'

export type AdvancedToolMode = 'schema' | 'data' | 'transfer' | 'er' | 'routine'

export interface DatabaseTarget {
  connection: DatabaseConnection
  database: DatabaseItem
}

export interface TableTarget extends DatabaseTarget {
  table: TableItem
}

export interface DiffRow {
  object: string
  source: string
  target: string
  status: 'same' | 'added' | 'removed' | 'changed'
}

export const databaseKey = (target: DatabaseTarget): string =>
  `${target.connection.id}\u0000${target.database.name}`

export const tableKey = (target: TableTarget): string =>
  `${databaseKey(target)}\u0000${target.table.name}`

export const labelStatus = {
  same: '一致',
  added: '目标新增',
  removed: '目标缺少',
  changed: '已变更'
} as const
