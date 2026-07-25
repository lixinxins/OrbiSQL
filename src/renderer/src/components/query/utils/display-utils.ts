/**
 * 查询结果的显示格式化工具函数
 * 提供 SQL 标识符转义、值字面量格式化、日期时间格式化、耗时格式化，
 * 以及根据行数据生成 INSERT / UPDATE SQL 语句的能力。
 */

/**
 * 将标识符名用反引号包裹，防止与 SQL 关键字冲突
 * 内部反引号会转义为双反引号（``）。
 * @param value - 原始标识符名（表名、字段名等）
 * @returns 反引号包裹的标识符字符串
 */
export const sqlIdentifier = (value: string): string => `\`${value.replaceAll('`', '``')}\``

/**
 * 将 JavaScript 值格式化为 SQL 字面量字符串
 * - null/undefined → NULL
 * - 数字/BigInt → 直接转字符串
 * - 布尔值 → 1 或 0
 * - Uint8Array → X'十六进制' 格式
 * - 其他 → 单引号字符串（转义反斜杠和单引号）
 * @param value - 待格式化的值
 * @returns SQL 字面量字符串
 */
export const sqlValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  // 二进制数据转为十六进制字面量
  if (value instanceof Uint8Array) return `X'${Array.from(value).map((byte) => byte.toString(16).padStart(2, '0')).join('')}'`
  // 字符串值：转义反斜杠，单引号加倍
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

/**
 * 将 ISO 日期时间字符串格式化为 zh-CN 本地化显示
 * 格式：YYYY-MM-DD HH:mm:ss（24 小时制），解析失败时返回 '--'。
 * @param iso - ISO 8601 日期时间字符串
 * @returns 格式化后的日期时间字符串
 */
export const formatDateTime = (iso?: string): string => {
  if (!iso) return '--'
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).replaceAll('/', '-')
  } catch {
    return '--'
  }
}

/**
 * 将毫秒耗时格式化为秒级字符串（保留 6 位小数）
 * @param ms - 毫秒数
 * @returns 格式化后的耗时字符串，如 "0.001234s"
 */
export const formatDurationSeconds = (ms?: number): string => `${((ms ?? 0) / 1000).toFixed(6)}s`

/**
 * 根据行数据生成 INSERT INTO SQL 语句
 * @param databaseName - 数据库名
 * @param tableName - 表名
 * @param columns - 列信息（sourceName 为实际字段名，resultName 为行数据中的键名）
 * @param row - 行数据，键为 resultName，值为字段值
 * @returns 完整的 INSERT SQL 语句
 */
export const buildInsertSql = (
  databaseName: string,
  tableName: string,
  columns: { sourceName: string; resultName: string }[],
  row: Record<string, unknown>
): string => {
  return `INSERT INTO ${sqlIdentifier(databaseName)}.${sqlIdentifier(tableName)} (${columns.map((column) => sqlIdentifier(column.sourceName)).join(', ')}) VALUES (${columns.map((column) => sqlValue(row[column.resultName])).join(', ')});`
}

/**
 * 根据行数据和变更列生成 UPDATE SQL 语句
 * 使用 NULL 安全比较（<=>）作为 WHERE 条件，确保 NULL 值也能正确匹配。
 * @param databaseName - 数据库名
 * @param tableName - 表名
 * @param changedColumns - 被修改的列信息
 * @param primaryKeys - 主键列信息，用于定位行
 * @param row - 行数据，键为 resultName，值为字段值
 * @returns 完整的 UPDATE SQL 语句
 */
export const buildUpdateSql = (
  databaseName: string,
  tableName: string,
  changedColumns: { sourceName: string; resultName: string }[],
  primaryKeys: { sourceName: string; resultName: string }[],
  row: Record<string, unknown>
): string => {
  return `UPDATE ${sqlIdentifier(databaseName)}.${sqlIdentifier(tableName)} SET ${changedColumns.map((column) => `${sqlIdentifier(column.sourceName)} = ${sqlValue(row[column.resultName])}`).join(', ')} WHERE ${primaryKeys.map((column) => `${sqlIdentifier(column.sourceName)} <=> ${sqlValue(row[column.resultName])}`).join(' AND ')};`
}
