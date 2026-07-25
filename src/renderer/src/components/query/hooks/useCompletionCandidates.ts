/**
 * 从当前数据库元数据派生 SQL 自动补全候选词 hook
 * 合并 SQL 关键字、表名和字段名，去重后供编辑器补全使用。
 */
import { useMemo } from 'react'
import type { DatabaseItem } from '@/shared/connections'
import { SQL_KEYWORDS } from '../utils/sql-utils'

/**
 * 从当前数据库元数据派生 SQL 自动补全候选词
 * @param database - 当前数据库元数据
 * @returns 去重后的候选词数组，包含 SQL 关键字 + 表名 + 字段名
 */
export function useCompletionCandidates(database?: DatabaseItem): string[] {
  return useMemo(() => {
    const tableNames = database?.tables.map((table) => table.name) ?? []
    const columnNames = database?.tables.flatMap((table) => table.columns.map((col) => col.name)) ?? []
    return Array.from(new Set([...SQL_KEYWORDS, ...tableNames, ...columnNames]))
  }, [database])
}
