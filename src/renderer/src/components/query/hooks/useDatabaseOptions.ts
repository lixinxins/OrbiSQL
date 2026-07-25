/**
 * 从连接列表派生数据库下拉选项 hook
 * 过滤已连接的数据库，生成供 SearchableSelect 使用的选项列表。
 */
import { useMemo } from 'react'
import type { DatabaseConnection } from '@/shared/connections'

/** 数据库下拉选项接口 */
export interface DatabaseOption {
  value: string
  label: string
  keywords: string
}

/**
 * 从连接列表派生数据库下拉选项
 * @param connections - 所有数据库连接
 * @returns 已连接数据库的选项数组，value 格式为 "connectionId\u0000databaseName"
 */
export function useDatabaseOptions(connections: DatabaseConnection[]): DatabaseOption[] {
  return useMemo(() => connections
    .filter((connection) => connection.connected)
    .flatMap((connection) => connection.databases.map((database) => ({
      value: `${connection.id}\u0000${database.name}`,
      label: `${connection.name} / ${database.name}`,
      keywords: `${connection.engine} ${database.name}`
    }))), [connections])
}
