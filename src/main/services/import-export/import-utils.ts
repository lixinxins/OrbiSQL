import type { StoredConnection } from '../../database/connection-repository'
import { quoteMysqlIdentifier } from '../adapters/mysql-adapter'

export const isMysqlFamily = (engine: string): boolean =>
  engine === 'MySQL' || engine === 'MariaDB' || engine === 'TiDB'

export const isPgFamily = (engine: string): boolean =>
  engine === 'PostgreSQL' || engine === '达梦' || engine === '人大金仓'

export const quoteIdentifierForEngine = (engine: StoredConnection['engine'], identifier: string): string =>
  engine === 'PostgreSQL'
    ? `"${identifier.replaceAll('"', '""')}"`
    : quoteMysqlIdentifier(identifier)

/** 加固字符串字面量转义：先转义反斜杠再转义单引号，降低 SQL 注入面 */
export const quotePortableString = (value: string): string =>
  `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`

/** 各引擎参数占位符上限（保守值），用于动态计算批量大小，避免 too many SQL variables */
const maxParamsForEngine = (engine: string): number => {
  if (engine === 'SQLite') return 900
  if (isPgFamily(engine) || engine === 'SQL Server') return 2000
  if (isMysqlFamily(engine)) return 6000
  return 500
}

/** 根据列数动态计算批量大小，确保占位符总数不超过引擎上限，并 cap 到 500 */
export const computeBatchSize = (engine: string, columnCount: number): number =>
  Math.max(1, Math.min(500, Math.floor(maxParamsForEngine(engine) / Math.max(1, columnCount))))

export const errorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return '数据库连接失败'
  if ('code' in error) {
    const code = String(error.code)
    if (code === 'ECONNREFUSED') return '无法连接数据库，请确认数据库服务已启动且主机、端口正确'
    if (code === 'ER_ACCESS_DENIED_ERROR') return '用户名或密码错误'
    if (code === '28P01') return 'PostgreSQL 用户名或密码错误'
    if (code === '3D000') return 'PostgreSQL 默认数据库不存在'
    if (code === 'SQLITE_CANTOPEN') return '无法打开 SQLite 数据库文件，请检查路径和文件权限'
    if (code === 'ENOTFOUND') return '找不到数据库主机'
  }
  return error.message || '数据库连接失败'
}
