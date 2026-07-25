/**
 * 300ms 防抖 SQL 语法验证 hook
 * 避免每次按键都执行词法分析，减少编辑长 SQL 时的卡顿。
 */
import { useEffect, useState } from 'react'
import type { DatabaseItem } from '@/shared/connections'
import { validateSql, type SqlValidation } from '../utils/sql-utils'

/**
 * 300ms 防抖 SQL 语法验证
 * @param sql - 当前 SQL 文本
 * @param database - 当前数据库元数据，用于校验表名和字段名
 * @returns 验证结果，包含词法标记、错误位置集合和错误消息列表
 */
export function useSqlValidation(sql: string, database?: DatabaseItem): SqlValidation {
  const [validation, setValidation] = useState<SqlValidation>(() => validateSql(sql, database))

  // SQL 验证防抖 300ms：避免每次按键都执行词法分析，减少编辑长 SQL 时的卡顿
  useEffect(() => {
    const timer = setTimeout(() => setValidation(validateSql(sql, database)), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql])

  useEffect(() => {
    setValidation(validateSql(sql, database))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [database])

  return validation
}
