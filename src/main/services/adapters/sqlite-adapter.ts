import { basename } from 'node:path'
import {
  sqliteWorkerOpen,
  sqliteWorkerClose,
  sqliteWorkerExec,
  sqliteWorkerQuery,
  sqliteWorkerGet,
  sqliteWorkerAll,
  sqliteWorkerExport,
  onSqliteExportProgress,
  offSqliteExportProgress
} from '../sqlite-runtime'
import {
  isSelectQuery,
  applyLimit,
  applyLimitOffset,
  QUERY_ROW_LIMIT,
  createCursor,
  updateCursorOffset,
  deleteCursor
} from '../query-cursor-manager'
import type { QueryCursor } from '../query-cursor-manager'
import type {
  ConnectionActionResult,
  CreateTableInput,
  DatabaseItem,
  ExportSqlProgress,
  MySQLColumnType,
  QueryDeleteRowInput,
  QueryExecutionResult,
  QueryUpdateRowInput,
  TableColumn,
  TableColumnDefinition,
  TableDataFilter,
  TableDefinitionResult,
  TableForeignKeyDefinition,
  TableIndexDefinition,
  UpdateTableInput
} from '@/shared/connections'
import type { AdapterConnection } from './postgresql-adapter'

// ── helpers ────────────────────────────────────────────────────────────

const quoteSqlite = (value: string): string => `"${value.replaceAll('"', '""')}"`
const quoteLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`
const sqliteCommentMarker = (comment: string): string => comment
  ? ` /* OmniDBTableComment:${Buffer.from(comment, 'utf8').toString('base64')} */`
  : ''

const portableType = (column: TableColumnDefinition): string => {
  if (['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT', 'YEAR', 'BOOLEAN', 'BIT'].includes(column.type)) return 'INTEGER'
  if (['DECIMAL'].includes(column.type)) return 'NUMERIC'
  if (['FLOAT', 'DOUBLE'].includes(column.type)) return 'REAL'
  if (['BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB'].includes(column.type)) return 'BLOB'
  return 'TEXT'
}

const portableColumn = (column: TableColumnDefinition): string => {
  const parts = [quoteSqlite(column.name), portableType(column)]
  if (column.notNull || column.primaryKey) parts.push('NOT NULL')
  if (column.defaultValue === null) parts.push('DEFAULT NULL')
  else if (column.defaultValue !== undefined) {
    parts.push(`DEFAULT ${column.defaultValue}`)
  }
  return parts.join(' ')
}

const normalizedColumnType = (dataType: string): MySQLColumnType => {
  const type = dataType.toLowerCase()
  if (type.includes('bigint')) return 'BIGINT'
  if (type.includes('smallint')) return 'SMALLINT'
  if (type === 'integer' || type === 'int' || type.includes('serial')) return 'INT'
  if (type.includes('double')) return 'DOUBLE'
  if (type.includes('real') || type.includes('float')) return 'FLOAT'
  if (type.includes('numeric') || type.includes('decimal')) return 'DECIMAL'
  if (type.includes('bool')) return 'BOOLEAN'
  if (type.includes('json')) return 'JSON'
  if (type.includes('timestamp') || type.includes('datetime')) return 'DATETIME'
  if (type === 'date') return 'DATE'
  if (type.includes('time')) return 'TIME'
  if (type.includes('blob') || type.includes('bytea') || type.includes('binary')) return 'BLOB'
  if (type.includes('char') && !type.includes('varying')) return 'CHAR'
  if (type.includes('varchar') || type.includes('varying')) return 'VARCHAR'
  return 'TEXT'
}

const extractSqliteChecks = (createSql: string): string[] => {
  const checks: string[] = []
  const pattern = /(?:CONSTRAINT\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z0-9_$]+)\s+)?CHECK\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(createSql))) {
    const opening = createSql.indexOf('(', match.index)
    let depth = 0
    let quote = ''
    for (let index = opening; index < createSql.length; index += 1) {
      const character = createSql[index]
      if (quote) {
        if (character === quote && createSql[index - 1] !== '\\') quote = ''
        continue
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character
        continue
      }
      if (character === '(') depth += 1
      if (character === ')') {
        depth -= 1
        if (depth === 0) {
          checks.push(createSql.slice(match.index, index + 1))
          pattern.lastIndex = index + 1
          break
        }
      }
    }
  }
  return checks
}

const replaceSqliteIdentifier = (sql: string, currentName: string, nextName: string): string => {
  const escaped = currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return sql.split(/('(?:''|[^'])*')/g).map((part) => {
    if (part.startsWith("'")) return part
    return part
      .replace(new RegExp(`"${escaped}"|\`${escaped}\`|\\[${escaped}\\]`, 'g'), quoteSqlite(nextName))
      .replace(new RegExp(`\\b${escaped}\\b`, 'g'), nextName)
  }).join('')
}

const filterSqlite = (filter: TableDataFilter): string => {
  const column = quoteSqlite(filter.column)
  const textValue = quoteLiteral(filter.value)
  const textColumn = `CAST(${column} AS TEXT)`
  const conditions: Record<TableDataFilter['operator'], string> = {
    equals: `${column} = ${textValue}`,
    notEquals: `${column} <> ${textValue}`,
    contains: `${textColumn} LIKE ${quoteLiteral(`%${filter.value}%`)}`,
    startsWith: `${textColumn} LIKE ${quoteLiteral(`${filter.value}%`)}`,
    greaterThan: `${column} > ${textValue}`,
    greaterThanOrEqual: `${column} >= ${textValue}`,
    lessThan: `${column} < ${textValue}`,
    lessThanOrEqual: `${column} <= ${textValue}`,
    isEmpty: `${textColumn} = ''`,
    isEmptyOrNull: `(${column} IS NULL OR ${textColumn} = '')`,
    isNotEmpty: `(${column} IS NOT NULL AND ${textColumn} <> '')`,
    isNull: `${column} IS NULL`,
    isNotNull: `${column} IS NOT NULL`
  }
  return conditions[filter.operator]
}

// ── SQLite handle cache (Worker) ─────────────────────────────────────

const sqliteHandleIds = new Set<string>()

export const ensureSqliteHandle = async (connection: AdapterConnection): Promise<string> => {
  const handleId = connection.host
  if (!sqliteHandleIds.has(handleId)) {
    await sqliteWorkerOpen(handleId, handleId)
    sqliteHandleIds.add(handleId)
  }
  return handleId
}

/** 关闭 SQLite 文件句柄（通知 Worker 释放） */
export const closeSqliteHandle = async (connection: AdapterConnection): Promise<void> => {
  const handleId = connection.host
  if (sqliteHandleIds.has(handleId)) {
    sqliteHandleIds.delete(handleId)
    await sqliteWorkerClose(handleId)
  }
}

// ── SQLite functions ──────────────────────────────────────────────────

export const readSqliteDatabases = async (connection: AdapterConnection, options?: { light?: boolean }): Promise<DatabaseItem[]> => {
  const handleId = await ensureSqliteHandle(connection)
  const objects = await sqliteWorkerAll<{ name: string; type: string; sql: string | null; tableName: string }>(handleId, "SELECT name, type, sql, tbl_name AS tableName FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
  const tableRows = objects.filter((object) => object.type === 'table')

  if (options?.light) {
    const tables = tableRows.map((table) => {
      const encoded = table.sql?.match(/\/\*\s*OmniDBTableComment:([A-Za-z0-9+/=]+)\s*\*\//)?.[1]
      return {
        name: table.name,
        comment: encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '',
        columns: [] as TableColumn[],
        indexes: [] as string[],
        foreignKeys: [] as string[],
        checks: [] as string[],
        triggers: objects.filter((object) => object.type === 'trigger' && object.tableName === table.name).map((object) => object.name)
      }
    })
    return [{
      name: basename(connection.host),
      tables,
      views: objects.filter((object) => object.type === 'view').map((object) => object.name),
      functions: [],
      procedures: [],
      indexes: objects.filter((object) => object.type === 'index').map((object) => object.name),
      triggers: objects.filter((object) => object.type === 'trigger').map((object) => object.name)
    }]
  }

  const tables: DatabaseItem['tables'] = []
  for (const table of tableRows) {
    const columns = await sqliteWorkerAll<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(handleId, `PRAGMA table_info(${quoteSqlite(table.name)})`)
    const indexes = await sqliteWorkerAll<{ name: string }>(handleId, `PRAGMA index_list(${quoteSqlite(table.name)})`)
    const foreignKeys = await sqliteWorkerAll<{ id: number; table: string }>(handleId, `PRAGMA foreign_key_list(${quoteSqlite(table.name)})`)
    const checks = Array.from(table.sql?.matchAll(/(?:CONSTRAINT\s+["`\[]?([^\s"`\]]+)["`\]]?\s+)?CHECK\s*\(/gi) ?? []).map((match, index) => match[1] || `CHECK_${index + 1}`)
    tables.push({
      name: table.name,
      comment: (() => {
        const encoded = table.sql?.match(/\/\*\s*OmniDBTableComment:([A-Za-z0-9+/=]+)\s*\*\//)?.[1]
        return encoded ? Buffer.from(encoded, 'base64').toString('utf8') : ''
      })(),
      columns: columns.map((col) => ({
        name: col.name,
        type: col.type ?? 'TEXT',
        nullable: col.notnull === 0,
        isPrimaryKey: col.pk > 0,
        comment: undefined
      })),
      indexes: indexes.map((index) => index.name),
      foreignKeys: foreignKeys.map((foreignKey) => `FK_${foreignKey.id} → ${foreignKey.table}`),
      checks,
      triggers: objects.filter((object) => object.type === 'trigger' && object.tableName === table.name).map((object) => object.name)
    })
  }
  return [{
    name: basename(connection.host),
    tables,
    views: objects.filter((object) => object.type === 'view').map((object) => object.name),
    functions: [],
    procedures: [],
    indexes: objects.filter((object) => object.type === 'index').map((object) => object.name),
    triggers: objects.filter((object) => object.type === 'trigger').map((object) => object.name)
  }]
}

export const executeSqliteQuery = async (connection: AdapterConnection, sql: string): Promise<QueryExecutionResult> => {
  const handleId = await ensureSqliteHandle(connection)
  const startTime = new Date().toISOString()
  const startMs = performance.now()
  try {
    const isSelect = isSelectQuery(sql)
    const limitedSql = isSelect ? applyLimit(sql, QUERY_ROW_LIMIT) : sql
    const result = await sqliteWorkerQuery(handleId, limitedSql)
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    if ('columns' in result && result.columns.length) {
      const rows = result.rows.map((row) => ({ ...row }))
      const truncated = isSelect && rows.length >= QUERY_ROW_LIMIT
      let editable: QueryExecutionResult['editable']
      const tableName = sql.match(/\bFROM\s+["`\[]?([A-Za-z0-9_$]+)["`\]]?/i)?.[1]
      if (tableName) {
        const tableColumns = await sqliteWorkerAll<{ name: string; pk: number }>(handleId, `PRAGMA table_info(${quoteSqlite(tableName)})`)
        const primaryKeys = tableColumns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name)
        if (primaryKeys.length && primaryKeys.every((key) => result.columns.includes(key))) {
          const validColumns = new Set(tableColumns.map((column) => column.name))
          editable = {
            tableName,
            primaryKeys,
            columns: result.columns.filter((column) => validColumns.has(column)).map((column) => ({ resultName: column, sourceName: column, primaryKey: primaryKeys.includes(column) }))
          }
        }
      }
      let cursorId: string | undefined
      if (truncated) {
        const cursor = createCursor({
          engine: 'SQLite',
          connectionKey: connection.host,
          databaseName: '',
          sql,
          columns: result.columns,
          editable,
          offset: rows.length,
          totalRows: rows.length
        })
        cursorId = cursor.id
      }
      const msg = truncated ? `查询成功，显示前 ${rows.length} 行` : `查询成功，共 ${rows.length} 行`
      return { success: true, message: msg, columns: result.columns, rows, editable, startTime, endTime, durationMs, queryCount: 1, successCount: 1, errorCount: 0, truncated, cursorId }
    }
    const changes = 'changes' in result ? result.changes : 0
    return { success: true, message: `执行成功，影响 ${changes} 行`, affectedRows: changes, startTime, endTime, durationMs, queryCount: 1, successCount: 1, errorCount: 0 }
  } catch (error) {
    const endTime = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startMs)
    return { success: false, message: error instanceof Error ? error.message : '查询执行失败', startTime, endTime, durationMs, queryCount: 1, successCount: 0, errorCount: 1 }
  }
}

/** 通过游标获取更多 SQLite 行 */
export const fetchMoreSqliteRows = async (
  connection: AdapterConnection,
  cursor: QueryCursor,
  count: number = QUERY_ROW_LIMIT
): Promise<{ rows: Array<Record<string, unknown>>; done: boolean }> => {
  const handleId = await ensureSqliteHandle(connection)
  const limitedSql = applyLimitOffset(cursor.sql, count, cursor.offset)
  const result = await sqliteWorkerQuery(handleId, limitedSql)
  const rows = 'columns' in result ? result.rows.map((row) => ({ ...row })) : []
  const done = rows.length < count
  updateCursorOffset(cursor.id, cursor.offset + rows.length)
  if (done) deleteCursor(cursor.id)
  return { rows, done }
}

export const readSqliteTableData = async (
  connection: AdapterConnection,
  tableName: string,
  limit: number,
  offset: number,
  filter?: TableDataFilter
): Promise<QueryExecutionResult> => {
  if (filter?.column) {
    const handleId = await ensureSqliteHandle(connection)
    const columns = await sqliteWorkerAll<{ name: string }>(handleId, `PRAGMA table_info(${quoteSqlite(tableName)})`)
    if (!columns.some((column) => column.name === filter.column)) return { success: false, message: '筛选字段不存在' }
  }
  const where = filter?.column ? ` WHERE ${filterSqlite(filter)}` : ''
  const result = await executeSqliteQuery(connection, `SELECT * FROM ${quoteSqlite(tableName)}${where} LIMIT ${limit} OFFSET ${offset}`)
  return result.success && result.rows ? { ...result, message: `已加载 ${result.rows.length} 行数据` } : result
}

const sqliteEditableColumns = async (handleId: string, tableName: string): Promise<{ valid: Set<string>; primaryKeys: string[] }> => {
  const columns = await sqliteWorkerAll<{ name: string; pk: number }>(handleId, `PRAGMA table_info(${quoteSqlite(tableName)})`)
  return {
    valid: new Set(columns.map((column) => column.name)),
    primaryKeys: columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name)
  }
}

export const updateSqliteRow = async (connection: AdapterConnection, input: QueryUpdateRowInput): Promise<ConnectionActionResult> => {
  const handleId = await ensureSqliteHandle(connection)
  const metadata = await sqliteEditableColumns(handleId, input.tableName)
  const changes = Object.keys(input.changes)
  if (!metadata.primaryKeys.length || metadata.primaryKeys.some((key) => !(key in input.primaryKeyValues))) return { success: false, message: '查询结果缺少完整主键，无法安全保存' }
  if (changes.some((column) => !metadata.valid.has(column))) return { success: false, message: '包含无效字段，无法保存' }
  const params = [...changes.map((column) => input.changes[column]), ...metadata.primaryKeys.map((column) => input.primaryKeyValues[column])]
  const result = await sqliteWorkerQuery(handleId, `UPDATE ${quoteSqlite(input.tableName)} SET ${changes.map((column) => `${quoteSqlite(column)} = ?`).join(', ')} WHERE ${metadata.primaryKeys.map((column) => `${quoteSqlite(column)} IS ?`).join(' AND ')}`, params)
  const affected = 'changes' in result ? result.changes : 0
  return { success: true, message: affected ? '数据已保存' : '数据没有变化' }
}

export const deleteSqliteRow = async (connection: AdapterConnection, input: QueryDeleteRowInput): Promise<ConnectionActionResult> => {
  const handleId = await ensureSqliteHandle(connection)
  const metadata = await sqliteEditableColumns(handleId, input.tableName)
  if (!metadata.primaryKeys.length || metadata.primaryKeys.some((key) => !(key in input.primaryKeyValues))) return { success: false, message: '缺少完整主键，无法安全删除数据' }
  const result = await sqliteWorkerQuery(handleId, `DELETE FROM ${quoteSqlite(input.tableName)} WHERE ${metadata.primaryKeys.map((column) => `${quoteSqlite(column)} IS ?`).join(' AND ')}`, metadata.primaryKeys.map((column) => input.primaryKeyValues[column]))
  const affected = 'changes' in result ? result.changes : 0
  return affected ? { success: true, message: '数据已删除' } : { success: false, message: '未找到该数据，可能已被修改或删除' }
}

export const exportSqliteTables = async (
  connection: AdapterConnection,
  tableNames: string[],
  includeData: boolean,
  filePath: string,
  onProgress?: (progress: ExportSqlProgress) => void
): Promise<{ filePath: string; totalLength: number }> => {
  const handleId = await ensureSqliteHandle(connection)
  if (onProgress) {
    onSqliteExportProgress(filePath, onProgress)
  }
  try {
    const result = await sqliteWorkerExport(handleId, tableNames, includeData, filePath)
    return { filePath: result.filePath, totalLength: result.totalLength }
  } finally {
    offSqliteExportProgress(filePath)
  }
}

export const getSqliteTableDefinition = async (connection: AdapterConnection, tableName: string): Promise<TableDefinitionResult> => {
  const handleId = await ensureSqliteHandle(connection)
  const tableSql = await sqliteWorkerGet<{ sql?: string }>(handleId, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [tableName])
  const encodedComment = tableSql?.sql?.match(/\/\*\s*OmniDBTableComment:([A-Za-z0-9+/=]+)\s*\*\//)?.[1]
  const columns = await sqliteWorkerAll<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(handleId, `PRAGMA table_info(${quoteSqlite(tableName)})`)
  if (!columns.length) return { success: false, message: '数据表不存在或没有字段' }
  const indexRows = await sqliteWorkerAll<{ name: string; unique: number; origin: string }>(handleId, `PRAGMA index_list(${quoteSqlite(tableName)})`)
  const indexes: TableIndexDefinition[] = await Promise.all(
    indexRows.filter((index) => index.origin !== 'pk').map(async (index) => {
      const infoRows = await sqliteWorkerAll<{ name: string }>(handleId, `PRAGMA index_info(${quoteSqlite(index.name)})`)
      return { name: index.name, type: index.unique ? 'UNIQUE' : 'INDEX', columns: infoRows.map((c) => c.name) }
    })
  )
  const foreignKeyRows = await sqliteWorkerAll<{ id: number; from: string; table: string; to: string; on_delete: TableForeignKeyDefinition['onDelete']; on_update: TableForeignKeyDefinition['onUpdate'] }>(handleId, `PRAGMA foreign_key_list(${quoteSqlite(tableName)})`)
  return {
    success: true,
    message: '表结构读取成功',
    tableName,
    tableComment: encodedComment ? Buffer.from(encodedComment, 'base64').toString('utf8') : '',
    columns: columns.map((column) => ({
      name: column.name,
      originalName: column.name,
      type: normalizedColumnType(column.type),
      typeDefinition: column.type || 'TEXT',
      length: column.type.match(/\((\d+)/)?.[1] ?? '',
      decimals: column.type.match(/\(\d+\s*,\s*(\d+)\)/)?.[1] ?? '',
      notNull: Boolean(column.notnull),
      primaryKey: column.pk > 0,
      comment: '',
      defaultValue: column.dflt_value
    })),
    indexes,
    foreignKeys: foreignKeyRows.map((foreignKey) => ({
      name: `FK_${foreignKey.id}`,
      column: foreignKey.from,
      referencedTable: foreignKey.table,
      referencedColumn: foreignKey.to,
      onDelete: foreignKey.on_delete,
      onUpdate: foreignKey.on_update
    }))
  }
}

export const updateSqliteTable = async (connection: AdapterConnection, input: UpdateTableInput): Promise<ConnectionActionResult> => {
  const handleId = await ensureSqliteHandle(connection)
  const temporaryName = `__omnidb_edit_${Date.now()}`
  try {
    const original = await sqliteWorkerGet<{ sql?: string }>(handleId, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [input.currentTableName])
    if (!original?.sql) return { success: false, message: '数据表不存在或已被删除' }
    const triggers = await sqliteWorkerAll<{ sql: string }>(handleId, "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name", [input.currentTableName])

    const columnNames = new Set<string>()
    for (const column of input.columns) {
      if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
      if (columnNames.has(column.name)) return { success: false, message: `字段"${column.name}"重复` }
      columnNames.add(column.name)
    }
    for (const index of input.indexes) {
      if (!index.name.trim() || !index.columns.length || index.columns.some((column) => !columnNames.has(column))) {
        return { success: false, message: `索引"${index.name || '未命名'}"设置不正确` }
      }
    }

    const definitions = input.columns.map((column) => portableColumn(column))
    const primaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => quoteSqlite(column.name))
    if (primaryKeys.length) definitions.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
    for (const foreignKey of input.foreignKeys) {
      if (!foreignKey.name || !columnNames.has(foreignKey.column) || !foreignKey.referencedTable || !foreignKey.referencedColumn) {
        return { success: false, message: `外键"${foreignKey.name || '未命名'}"设置不正确` }
      }
      definitions.push(`CONSTRAINT ${quoteSqlite(foreignKey.name)} FOREIGN KEY (${quoteSqlite(foreignKey.column)}) REFERENCES ${quoteSqlite(foreignKey.referencedTable)} (${quoteSqlite(foreignKey.referencedColumn)}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`)
    }
    const renamedColumns = input.columns.filter((column) => column.originalName && column.originalName !== column.name)
    const checks = extractSqliteChecks(original.sql).map((check) => renamedColumns.reduce(
      (sql, column) => replaceSqliteIdentifier(sql, column.originalName ?? column.name, column.name),
      check
    ))
    definitions.push(...checks)

    const retainedColumns = input.columns.filter((column) => column.originalName)
    const destinationColumns = retainedColumns.map((column) => quoteSqlite(column.name)).join(', ')
    const sourceColumns = retainedColumns.map((column) => quoteSqlite(column.originalName ?? column.name)).join(', ')
    const oldTable = quoteSqlite(input.currentTableName)
    const temporaryTable = quoteSqlite(temporaryName)
    const targetTable = quoteSqlite(input.tableName)

    await sqliteWorkerExec(handleId, 'PRAGMA foreign_keys = OFF')
    await sqliteWorkerExec(handleId, 'BEGIN IMMEDIATE')
    try {
      await sqliteWorkerExec(handleId, `CREATE TABLE ${temporaryTable}${sqliteCommentMarker(input.tableComment)} (${definitions.join(', ')})`)
      if (retainedColumns.length) await sqliteWorkerExec(handleId, `INSERT INTO ${temporaryTable} (${destinationColumns}) SELECT ${sourceColumns} FROM ${oldTable}`)
      await sqliteWorkerExec(handleId, `DROP TABLE ${oldTable}`)
      await sqliteWorkerExec(handleId, `ALTER TABLE ${temporaryTable} RENAME TO ${targetTable}`)
      for (const index of input.indexes) {
        await sqliteWorkerExec(handleId, `CREATE ${index.type === 'UNIQUE' ? 'UNIQUE ' : ''}INDEX ${quoteSqlite(index.name)} ON ${targetTable} (${index.columns.map(quoteSqlite).join(', ')})`)
      }
      for (const trigger of triggers) {
        let triggerSql = renamedColumns.reduce(
          (sql, column) => replaceSqliteIdentifier(sql, column.originalName ?? column.name, column.name),
          trigger.sql
        )
        if (input.tableName !== input.currentTableName) {
          const escapedName = input.currentTableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          triggerSql = triggerSql.replace(
            new RegExp(`(\\bON\\s+)(?:"${escapedName}"|\`${escapedName}\`|\\[${escapedName}\\]|${escapedName})(\\s+)`, 'i'),
            `$1${targetTable}$2`
          )
        }
        await sqliteWorkerExec(handleId, triggerSql)
      }
      const fkCheck = await sqliteWorkerGet(handleId, 'PRAGMA foreign_key_check')
      if (fkCheck) {
        throw new Error('现有数据违反新的外键约束，已取消本次表结构修改')
      }
      await sqliteWorkerExec(handleId, 'COMMIT')
    } catch (error) {
      await sqliteWorkerExec(handleId, 'ROLLBACK')
      throw error
    } finally {
      await sqliteWorkerExec(handleId, 'PRAGMA foreign_keys = ON')
    }
    return { success: true, message: 'SQLite 表结构已保存' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'SQLite 表结构保存失败' }
  }
}

export const executeSqliteFile = async (connection: AdapterConnection, sql: string): Promise<void> => {
  const handleId = await ensureSqliteHandle(connection)
  await sqliteWorkerExec(handleId, sql)
}

/** 创建 SQLite 可移植表（从 MySQL 迁移） */
export const createSqlitePortableTable = async (
  connection: AdapterConnection,
  input: CreateTableInput
): Promise<ConnectionActionResult> => {
  const names = new Set<string>()
  for (const column of input.columns) {
    if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
    if (names.has(column.name)) return { success: false, message: `字段"${column.name}"重复` }
    names.add(column.name)
  }
  const definitions = input.columns.map((column) => portableColumn(column))
  const primaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => quoteSqlite(column.name))
  if (primaryKeys.length) definitions.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)
  for (const foreignKey of input.foreignKeys) {
    if (!names.has(foreignKey.column) || !foreignKey.referencedTable || !foreignKey.referencedColumn) return { success: false, message: `外键"${foreignKey.name || '未命名'}"设置不正确` }
    definitions.push(`CONSTRAINT ${quoteSqlite(foreignKey.name)} FOREIGN KEY (${quoteSqlite(foreignKey.column)}) REFERENCES ${quoteSqlite(foreignKey.referencedTable)} (${quoteSqlite(foreignKey.referencedColumn)}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`)
  }
  const table = quoteSqlite(input.tableName)
  const statements = [`CREATE TABLE ${table}${sqliteCommentMarker(input.tableComment)} (${definitions.join(', ')})`]
  input.indexes.forEach((index) => {
    const unique = index.type === 'UNIQUE' ? 'UNIQUE ' : ''
    statements.push(`CREATE ${unique}INDEX ${quoteSqlite(index.name)} ON ${table} (${index.columns.map(quoteSqlite).join(', ')})`)
  })
  try {
    const handleId = await ensureSqliteHandle(connection)
    try {
      await sqliteWorkerExec(handleId, 'BEGIN')
      for (const statement of statements) await sqliteWorkerExec(handleId, statement)
      await sqliteWorkerExec(handleId, 'COMMIT')
    } catch (error) {
      try { await sqliteWorkerExec(handleId, 'ROLLBACK') } catch { /* 保留原始错误 */ }
      throw error
    }
    return { success: true, message: '数据表已创建' }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : '数据表创建失败' }
  }
}
