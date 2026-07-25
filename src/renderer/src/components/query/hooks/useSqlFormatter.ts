/**
 * SQL 格式化与压缩 hook
 * 基于 sql-formatter 库实现格式化，基于自定义 compressSqlText 实现压缩。
 */
import { format as formatSqlText } from 'sql-formatter'
import { compressSqlText } from '../utils/sql-utils'

/** useSqlFormatter 返回值接口 */
export interface UseSqlFormatterReturn {
  formatSql: () => void
  compressSql: () => void
}

/**
 * SQL 格式化与压缩 hook
 * @param sql - 当前 SQL 文本
 * @param setSql - SQL 更新回调
 * @param engine - 数据库引擎类型，用于选择格式化方言
 * @param editorRef - 编辑器 DOM ref，格式化后重新聚焦
 * @param setFormatError - 格式化错误信息设置回调
 * @returns formatSql 和 compressSql 两个操作函数
 */
export function useSqlFormatter(
  sql: string,
  setSql: (sql: string) => void,
  engine: string | undefined,
  editorRef: React.RefObject<HTMLDivElement | null>,
  setFormatError: (error: string) => void
): UseSqlFormatterReturn {
  /** 格式化 SQL：使用 sql-formatter 库，根据引擎类型选择方言，关键字大写 */
  const formatSql = (): void => {
    if (!sql.trim()) return
    try {
      const formatted = formatSqlText(sql, {
        language: engine === 'PostgreSQL'
          ? 'postgresql'
          : engine === 'SQLite' ? 'sqlite' : 'mysql',
        keywordCase: 'upper',
        tabWidth: 2,
        linesBetweenQueries: 1
      })
      setSql(formatted)
      setFormatError('')
      requestAnimationFrame(() => (editorRef.current as HTMLDivElement & { focus: () => void })?.focus?.())
    } catch (error) {
      setFormatError(`SQL 格式化失败：${error instanceof Error ? error.message : '语句格式不正确'}`)
    }
  }

  /** 压缩 SQL：去除多余空白，注释转为块注释内联 */
  const compressSql = (): void => {
    if (!sql.trim()) return
    try {
      setSql(compressSqlText(sql))
      setFormatError('')
      requestAnimationFrame(() => (editorRef.current as HTMLDivElement & { focus: () => void })?.focus?.())
    } catch (error) {
      setFormatError(`SQL 压缩失败：${error instanceof Error ? error.message : '语句格式不正确'}`)
    }
  }

  return { formatSql, compressSql }
}
