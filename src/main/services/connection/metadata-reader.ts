import type {
  ConnectionActionResult,
  CopyTableInput,
  CreateConnectionInput,
  CreateTableInput,
  DatabaseCharsetResult,
  DatabaseDefinitionInput,
  DatabaseItem,
  QueryExecutionResult,
  RenameTableInput,
  TableColumnDefinition,
  TableDataFilter,
  TableDefinitionResult,
  TableForeignKeyDefinition,
  TableIndexDefinition,
  UpdateDatabaseInput,
  UpdateTableInput
} from '../../../shared/connections'
import type { StoredConnection } from '../../database/connection-repository'
import { engineEntryOrNull, requireEngineEntry } from '../engine-registry'
import { sshTunnelManager } from '../ssh-tunnel-manager'
import {
  createPostgreSqlPortableTable,
  executePostgreSqlQuery,
  getPostgreSqlTableDefinition,
  updatePostgreSqlTableComment,
  type ReadDatabasesOptions
} from '../adapters/postgresql-adapter'
import {
  createSqlitePortableTable,
  executeSqliteQuery,
  getSqliteTableDefinition,
  updateSqliteTable
} from '../adapters/sqlite-adapter'
import { buildColumnDefinition, getMysqlPool } from '../adapters/mysql-adapter'
import type { ConnectionCore } from './connection-core'
import type { QueryExecution } from './query-execution'
import type { WorkspaceStats } from './workspace-stats'

/** 元数据读取与库表 DDL：库列表、表结构、表数据、建表/改表/复制表、库级 DDL。 */
export class MetadataReader {
  constructor(
    private readonly core: ConnectionCore,
    private readonly query: QueryExecution,
    private readonly stats: WorkspaceStats
  ) {}

  async readDatabases(
    connection: StoredConnection | CreateConnectionInput,
    options?: ReadDatabasesOptions
  ): Promise<DatabaseItem[]> {
    if (connection.engine === 'SSH') return []
    const persistentId = 'id' in connection && typeof connection.id === 'number' ? connection.id : -1
    const persistent = persistentId > 0
    const stored = 'sshEnabled' in connection
      ? connection
      : this.core.storedInput(connection, persistentId)
    const tunnelKey: string | number = persistent ? stored.id : `test-${Date.now()}-${Math.random()}`
    const runtime = await this.core.prepareRuntimeConnection(stored, tunnelKey)
    try {
      const entry = requireEngineEntry(runtime.engine)
      return await entry.readDatabases(runtime, options, persistent)
    } finally {
      if (!persistent) sshTunnelManager.closeTunnel(tunnelKey)
    }
  }

  /**
   * 按需加载单个数据库的完整元数据（P0-3 懒加载）。
   * 仅在连接已打开且需要查看数据库详情时调用。
   */
  async readDatabaseDetail(connectionId: number, databaseName: string): Promise<DatabaseItem | null> {
    const stored = this.core.repository.getById(connectionId)
    if (!stored || !stored.open) return null

    const runtime = await this.core.prepareRuntimeConnection(stored, stored.id)
    const entry = engineEntryOrNull(runtime.engine)
    if (!entry?.readDatabaseDetail) return null
    try {
      return await entry.readDatabaseDetail(runtime, databaseName)
    } catch (error) {
      console.error('读取数据库详情失败：', this.core.errorMessage(error))
      return null
    }
  }

  async listCharsets(connectionId: number): Promise<DatabaseCharsetResult> {
    const connection = this.core.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    const entry = engineEntryOrNull(connection.engine)
    if (!entry?.listCharsets) return { success: false, message: '该引擎不支持读取字符集' }
    return await entry.listCharsets(connection)
  }

  async getTableDefinition(
    connectionId: number,
    databaseName: string,
    tableName: string
  ): Promise<TableDefinitionResult> {
    const connection = this.core.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    try {
      const entry = requireEngineEntry(connection.engine)
      if (!entry.getTableDefinition) return { success: false, message: '该引擎暂不支持查看表结构' }
      return await entry.getTableDefinition(connection, databaseName, tableName)
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async readTableData(
    connectionId: number,
    databaseName: string,
    tableName: string,
    limit: number,
    offset: number,
    filter?: TableDataFilter
  ): Promise<QueryExecutionResult> {
    const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)))
    const safeOffset = Math.max(0, Math.trunc(offset))
    const connection = this.core.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    try {
      const entry = requireEngineEntry(connection.engine)
      return await entry.readTableData(connection, databaseName, tableName, safeLimit, safeOffset, filter)
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async createDatabase(input: DatabaseDefinitionInput): Promise<ConnectionActionResult> {
    const validation = this.core.validateDatabaseDefinition(input)
    if (validation) return { success: false, message: validation }
    const connection = this.core.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'SQLite') return { success: false, message: 'SQLite 连接即数据库文件，请通过新建连接添加其他文件' }
    if (connection.engine === 'DuckDB') return { success: false, message: 'DuckDB 连接即数据库文件，请通过新建连接添加其他文件' }
    if (connection.engine === 'PostgreSQL') {
      const result = await this.query.executeSql(input.connectionId, `CREATE DATABASE ${this.core.quoteIdentifierForEngine('PostgreSQL', input.name)} ENCODING 'UTF8'`)
      if (result.success) await this.stats.refreshPersistedDatabaseStats(connection)
      return result.success ? { success: true, message: '数据库已创建' } : result
    }
    return this.executeDatabaseStatement(
      input.connectionId,
      `CREATE DATABASE ${this.core.quoteIdentifier(input.name)} CHARACTER SET ${input.charset} COLLATE ${input.collation}`,
      '数据库已创建'
    )
  }

  async updateDatabase(input: UpdateDatabaseInput): Promise<ConnectionActionResult> {
    const validation = this.core.validateDatabaseDefinition(input)
    if (validation) return { success: false, message: validation }
    const connection = this.core.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'SQLite') return { success: false, message: 'SQLite 数据库名称由文件名决定' }
    if (connection.engine === 'DuckDB') return { success: false, message: 'DuckDB 数据库名称由文件名决定' }
    if (connection.engine === 'PostgreSQL') {
      if (input.name === input.currentName) return { success: true, message: '数据库没有变化' }
      const result = await this.query.executeSql(input.connectionId, `ALTER DATABASE ${this.core.quoteIdentifierForEngine('PostgreSQL', input.currentName)} RENAME TO ${this.core.quoteIdentifierForEngine('PostgreSQL', input.name)}`)
      if (result.success) await this.stats.refreshPersistedDatabaseStats(connection)
      return result.success ? { success: true, message: '数据库已更新' } : result
    }
    return this.executeDatabaseStatement(
      input.connectionId,
      `ALTER DATABASE ${this.core.quoteIdentifier(input.currentName)} CHARACTER SET ${input.charset} COLLATE ${input.collation}`,
      '数据库已更新'
    )
  }

  async deleteDatabase(connectionId: number, databaseName: string): Promise<ConnectionActionResult> {
    const connection = this.core.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'SQLite') return { success: false, message: '为避免误删文件，请在连接列表中删除 SQLite 连接' }
    if (connection.engine === 'DuckDB') return { success: false, message: '为避免误删文件，请在连接列表中删除 DuckDB 连接' }
    if (connection.engine === 'PostgreSQL') {
      const result = await this.query.executeSql(connectionId, `DROP DATABASE ${this.core.quoteIdentifierForEngine('PostgreSQL', databaseName)}`)
      if (result.success) this.core.repository.removeDatabaseStats(connectionId, databaseName)
      return result.success ? { success: true, message: '数据库已删除' } : result
    }
    const result = await this.executeDatabaseStatement(
      connectionId,
      `DROP DATABASE ${this.core.quoteIdentifier(databaseName)}`,
      '数据库已删除'
    )
    if (result.success) this.core.repository.removeDatabaseStats(connectionId, databaseName)
    return result
  }

  async deleteTable(connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> {
    const connection = this.core.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine !== 'MySQL') {
      const result = await this.query.executeQuery(connectionId, databaseName, `DROP TABLE ${this.core.quoteIdentifierForEngine(connection.engine, tableName)}`)
      return result.success ? { success: true, message: '数据表已删除' } : result
    }
    return this.executeDatabaseStatement(
      connectionId,
      `DROP TABLE ${this.core.quoteIdentifier(databaseName)}.${this.core.quoteIdentifier(tableName)}`,
      '数据表已删除'
    )
  }

  async renameTable(input: RenameTableInput): Promise<ConnectionActionResult> {
    const newTableName = input.newTableName.trim()
    if (!newTableName) return { success: false, message: '请输入新的表名称' }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(newTableName)) {
      return { success: false, message: '表名称须以英文字母开头，只能包含英文字母、数字和下划线' }
    }
    if (newTableName === input.currentTableName) return { success: false, message: '新表名称不能与原表相同' }

    const connection = this.core.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    if (connection.engine === 'MySQL' && newTableName.length > 64) {
      return { success: false, message: 'MySQL 表名称不能超过 64 个字符' }
    }
    if (connection.engine === 'PostgreSQL' && newTableName.length > 63) {
      return { success: false, message: 'PostgreSQL 表名称不能超过 63 个字符' }
    }

    const current = this.core.quoteIdentifierForEngine(connection.engine, input.currentTableName)
    const target = this.core.quoteIdentifierForEngine(connection.engine, newTableName)
    const sql = connection.engine === 'MySQL'
      ? `RENAME TABLE ${this.core.quoteIdentifier(input.databaseName)}.${current} TO ${this.core.quoteIdentifier(input.databaseName)}.${target}`
      : `ALTER TABLE ${current} RENAME TO ${target}`
    const result = await this.query.executeQuery(input.connectionId, input.databaseName, sql)
    return result.success ? { success: true, message: '数据表名称已修改' } : result
  }

  async truncateTable(connectionId: number, databaseName: string, tableName: string): Promise<ConnectionActionResult> {
    const connection = this.core.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine !== 'MySQL') {
      const command = connection.engine === 'SQLite' || connection.engine === 'DuckDB' ? 'DELETE FROM' : 'TRUNCATE TABLE'
      const result = await this.query.executeQuery(connectionId, databaseName, `${command} ${this.core.quoteIdentifierForEngine(connection.engine, tableName)}`)
      return result.success ? { success: true, message: '数据表已清空' } : result
    }
    return this.executeDatabaseStatement(
      connectionId,
      `TRUNCATE TABLE ${this.core.quoteIdentifier(databaseName)}.${this.core.quoteIdentifier(tableName)}`,
      '数据表已清空'
    )
  }

  async copyTable(input: CopyTableInput): Promise<ConnectionActionResult> {
    if (!input.targetTableName.trim()) return { success: false, message: '请输入新表名称' }
    const targetDb = input.targetDatabaseName || input.databaseName
    if ((!input.targetDatabaseName || input.targetDatabaseName === input.databaseName) && input.targetTableName === input.sourceTableName) {
      return { success: false, message: '同一数据库下新表名称不能与原表相同' }
    }
    const connection = this.core.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }

    try {
      if (connection.engine === 'MySQL' || connection.engine === 'MariaDB' || connection.engine === 'TiDB') {
        const pool = getMysqlPool(connection, targetDb)
        const srcFull = `${this.core.quoteIdentifier(input.databaseName)}.${this.core.quoteIdentifier(input.sourceTableName)}`
        const tgtFull = `${this.core.quoteIdentifier(targetDb)}.${this.core.quoteIdentifier(input.targetTableName)}`
        await pool.query(`CREATE TABLE ${tgtFull} LIKE ${srcFull}`)
        if (input.includeData) {
          await pool.query(`INSERT INTO ${tgtFull} SELECT * FROM ${srcFull}`)
        }
        await this.stats.refreshPersistedDatabaseStats(connection, targetDb)
        return {
          success: true,
          message: input.includeData
            ? `已成功复制数据表结构及数据到“${input.targetTableName}”`
            : `已成功复制数据表结构到“${input.targetTableName}”`
        }
      }

      if (connection.engine === 'PostgreSQL') {
        const source = `${this.core.quoteIdentifier(input.sourceTableName)}`
        const target = `${this.core.quoteIdentifier(input.targetTableName)}`
        const createSql = input.includeData
          ? `CREATE TABLE ${target} AS TABLE ${source}`
          : `CREATE TABLE ${target} (LIKE ${source} INCLUDING ALL)`
        const created = await executePostgreSqlQuery(connection, targetDb, createSql)
        if (!created.success) return { success: false, message: created.message || '复制数据表失败' }
        await this.stats.refreshPersistedDatabaseStats(connection, targetDb)
        return {
          success: true,
          message: input.includeData
            ? `已成功复制数据表结构及数据到“${input.targetTableName}”`
            : `已成功复制数据表结构到“${input.targetTableName}”`
        }
      }

      if (connection.engine === 'SQLite') {
        const source = `${this.core.quoteIdentifier(input.sourceTableName)}`
        const target = `${this.core.quoteIdentifier(input.targetTableName)}`
        const def = await getSqliteTableDefinition(connection, input.sourceTableName)
        if (!def.success || !def.columns) return def
        const ddlRes = await executeSqliteQuery(connection, `SELECT sql FROM sqlite_master WHERE type='table' AND name='${input.sourceTableName}'`)
        let createDdl = ''
        if (ddlRes.rows?.[0]?.sql) {
          createDdl = String(ddlRes.rows[0].sql).replace(new RegExp(`CREATE TABLE ["\`]?${input.sourceTableName}["\`]?`, 'i'), `CREATE TABLE ${target}`)
        } else {
          const colDefs = def.columns.map((c) => `${this.core.quoteIdentifier(c.name)} ${c.typeDefinition || c.type || 'TEXT'}`).join(', ')
          createDdl = `CREATE TABLE ${target} (${colDefs})`
        }
        const createRes = await executeSqliteQuery(connection, createDdl)
        if (!createRes.success) return { success: false, message: createRes.message || '创建复制表失败' }

        if (input.includeData) {
          await executeSqliteQuery(connection, `INSERT INTO ${target} SELECT * FROM ${source}`)
        }
        await this.stats.refreshPersistedDatabaseStats(connection, targetDb)
        return {
          success: true,
          message: input.includeData
            ? `已成功复制数据表结构及数据到“${input.targetTableName}”`
            : `已成功复制数据表结构到“${input.targetTableName}”`
        }
      }

      return { success: false, message: `暂不支持在 ${connection.engine} 引擎上复制表` }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  async createTable(input: CreateTableInput): Promise<ConnectionActionResult> {
    if (!input.tableName.trim()) return { success: false, message: '请输入表名称' }
    if (!input.columns.length) return { success: false, message: '请至少添加一个字段' }
    if ((input.tableComment ?? '').length > 2048) return { success: false, message: '表注释不能超过 2048 个字符' }
    const connection = this.core.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (connection.engine === 'PostgreSQL' || connection.engine === 'SQLite') {
      const result = connection.engine === 'PostgreSQL'
        ? createPostgreSqlPortableTable(connection, input)
        : createSqlitePortableTable(connection, input)
      const resolved = await result
      if (resolved.success) await this.stats.refreshPersistedDatabaseStats(connection, input.databaseName)
      return resolved
    }
    const columnNames = new Set<string>()
    const definitions: string[] = []

    for (const column of input.columns) {
      if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
      if (columnNames.has(column.name)) return { success: false, message: `字段“${column.name}”重复` }
      columnNames.add(column.name)
      const definition = buildColumnDefinition({ ...column, typeDefinition: undefined, extra: undefined })
      if (!definition) return { success: false, message: `字段“${column.name}”类型或长度不正确` }
      definitions.push(definition)
    }

    const primaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => this.core.quoteIdentifier(column.name))
    if (primaryKeys.length) definitions.push(`PRIMARY KEY (${primaryKeys.join(', ')})`)

    for (const index of input.indexes) {
      if (!index.name.trim()) return { success: false, message: '索引名称不能为空' }
      if (!index.columns.length) return { success: false, message: `索引“${index.name}”必须选择字段` }
      if (index.columns.some((column) => !columnNames.has(column))) return { success: false, message: `索引“${index.name}”包含不存在的字段` }
      const indexType = index.type === 'UNIQUE' ? 'UNIQUE KEY' : index.type === 'FULLTEXT' ? 'FULLTEXT KEY' : 'KEY'
      definitions.push(`${indexType} ${this.core.quoteIdentifier(index.name)} (${index.columns.map((column) => this.core.quoteIdentifier(column)).join(', ')})`)
    }

    const referenceActions = new Set(['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'])
    for (const foreignKey of input.foreignKeys) {
      if (!foreignKey.name.trim()) return { success: false, message: '外键名称不能为空' }
      if (!columnNames.has(foreignKey.column)) return { success: false, message: `外键“${foreignKey.name}”字段不存在` }
      if (!foreignKey.referencedTable || !foreignKey.referencedColumn) return { success: false, message: `外键“${foreignKey.name}”缺少引用表或字段` }
      if (!referenceActions.has(foreignKey.onDelete) || !referenceActions.has(foreignKey.onUpdate)) return { success: false, message: '外键动作不正确' }
      definitions.push([
        `CONSTRAINT ${this.core.quoteIdentifier(foreignKey.name)}`,
        `FOREIGN KEY (${this.core.quoteIdentifier(foreignKey.column)})`,
        `REFERENCES ${this.core.quoteIdentifier(foreignKey.referencedTable)} (${this.core.quoteIdentifier(foreignKey.referencedColumn)})`,
        `ON DELETE ${foreignKey.onDelete}`,
        `ON UPDATE ${foreignKey.onUpdate}`
      ].join(' '))
    }

    return this.executeDatabaseStatement(
      input.connectionId,
      `CREATE TABLE ${this.core.quoteIdentifier(input.databaseName)}.${this.core.quoteIdentifier(input.tableName)} (${definitions.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4${input.tableComment ? ` COMMENT=${this.core.quoteString(input.tableComment)}` : ''}`,
      '数据表已创建'
    )
  }

  async updateTable(input: UpdateTableInput): Promise<ConnectionActionResult> {
    if (!input.tableName.trim()) return { success: false, message: '请输入表名称' }
    if (!input.columns.length) return { success: false, message: '请至少保留一个字段' }
    if ((input.tableComment ?? '').length > 2048) return { success: false, message: '表注释不能超过 2048 个字符' }
    const targetConnection = this.core.repository.getById(input.connectionId)
    if (!targetConnection) return { success: false, message: '连接不存在' }
    if (targetConnection.engine === 'SQLite') {
      const result = await updateSqliteTable(targetConnection, input)
      if (result.success) await this.stats.refreshPersistedDatabaseStats(targetConnection, input.databaseName)
      return result
    }
    if (targetConnection.engine === 'PostgreSQL') {
      const currentDefinition = await getPostgreSqlTableDefinition(targetConnection, input.databaseName, input.currentTableName)
      if (!currentDefinition.success || !currentDefinition.columns || !currentDefinition.indexes || !currentDefinition.foreignKeys) return currentDefinition
      const columnSignature = (columns: TableColumnDefinition[]): string => JSON.stringify(columns.map((column) => [
        column.name, column.originalName, column.type, column.typeDefinition, column.length, column.decimals,
        column.notNull, column.primaryKey, column.comment, column.defaultValue, column.extra
      ]))
      const indexSignature = (indexes: TableIndexDefinition[]): string => JSON.stringify(indexes.map((index) => [index.name, index.type, index.columns]))
      const foreignKeySignature = (foreignKeys: TableForeignKeyDefinition[]): string => JSON.stringify(foreignKeys.map((foreignKey) => [
        foreignKey.name, foreignKey.column, foreignKey.referencedTable, foreignKey.referencedColumn, foreignKey.onDelete, foreignKey.onUpdate
      ]))
      const structureChanged = input.tableName !== input.currentTableName
        || columnSignature(input.columns) !== columnSignature(currentDefinition.columns)
        || indexSignature(input.indexes) !== indexSignature(currentDefinition.indexes)
        || foreignKeySignature(input.foreignKeys) !== foreignKeySignature(currentDefinition.foreignKeys)
      if (structureChanged) return { success: false, message: 'PostgreSQL 当前仅支持在设计器中修改表注释；字段结构请使用 ALTER TABLE' }
      const result = await updatePostgreSqlTableComment(targetConnection, input.databaseName, input.currentTableName, input.tableComment)
      if (result.success) await this.stats.refreshPersistedDatabaseStats(targetConnection, input.databaseName)
      return result
    }
    if (targetConnection.engine !== 'MySQL') {
      return { success: false, message: `${targetConnection.engine} 暂不支持在设计器中修改已有表结构，请使用查询页面执行 ALTER TABLE` }
    }
    const current = await this.getTableDefinition(input.connectionId, input.databaseName, input.currentTableName)
    if (!current.success || !current.columns || !current.indexes || !current.foreignKeys) return current

    const names = new Set<string>()
    for (const column of input.columns) {
      if (!column.name.trim()) return { success: false, message: '字段名称不能为空' }
      if (names.has(column.name)) return { success: false, message: `字段“${column.name}”重复` }
      names.add(column.name)
    }

    const clauses: string[] = []
    const indexSignature = (index: TableIndexDefinition): string => JSON.stringify([index.type, index.columns])
    const foreignKeySignature = (foreignKey: TableForeignKeyDefinition): string => JSON.stringify([
      foreignKey.column, foreignKey.referencedTable, foreignKey.referencedColumn, foreignKey.onDelete, foreignKey.onUpdate
    ])
    const inputIndexes = new Map(input.indexes.map((index) => [index.name, index]))
    const inputForeignKeys = new Map(input.foreignKeys.map((foreignKey) => [foreignKey.name, foreignKey]))
    current.foreignKeys
      .filter((foreignKey) => foreignKeySignature(foreignKey) !== foreignKeySignature(inputForeignKeys.get(foreignKey.name) ?? foreignKey) || !inputForeignKeys.has(foreignKey.name))
      .forEach((foreignKey) => clauses.push(`DROP FOREIGN KEY ${this.core.quoteIdentifier(foreignKey.name)}`))
    current.indexes
      .filter((index) => indexSignature(index) !== indexSignature(inputIndexes.get(index.name) ?? index) || !inputIndexes.has(index.name))
      .forEach((index) => clauses.push(`DROP INDEX ${this.core.quoteIdentifier(index.name)}`))

    const currentPrimaryKeys = current.columns.filter((column) => column.primaryKey).map((column) => column.name)
    const nextPrimaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => column.name)
    const primaryChanged = JSON.stringify(currentPrimaryKeys) !== JSON.stringify(nextPrimaryKeys)
    if (currentPrimaryKeys.length && primaryChanged) clauses.push('DROP PRIMARY KEY')

    const retainedOriginalNames = new Set(input.columns.map((column) => column.originalName).filter(Boolean))
    current.columns
      .filter((column) => !retainedOriginalNames.has(column.name))
      .forEach((column) => clauses.push(`DROP COLUMN ${this.core.quoteIdentifier(column.name)}`))

    for (const column of input.columns) {
      const original = column.originalName
        ? current.columns.find((currentColumn) => currentColumn.name === column.originalName)
        : undefined
      const safeColumn = original && original.type === column.type && original.typeDefinition === column.typeDefinition
        ? { ...column, typeDefinition: original.typeDefinition, extra: original.extra }
        : { ...column, typeDefinition: undefined, extra: undefined }
      const definition = buildColumnDefinition(safeColumn)
      if (!definition) return { success: false, message: `字段“${column.name}”类型或长度不正确` }
      const changed = !original || JSON.stringify([
        column.name, column.type, column.typeDefinition, column.length, column.decimals,
        column.notNull, column.primaryKey, column.comment, column.defaultValue, column.extra
      ]) !== JSON.stringify([
        original.name, original.type, original.typeDefinition, original.length, original.decimals,
        original.notNull, original.primaryKey, original.comment, original.defaultValue, original.extra
      ])
      if (changed) clauses.push(original
        ? `CHANGE COLUMN ${this.core.quoteIdentifier(original.name)} ${definition}`
        : `ADD COLUMN ${definition}`)
    }

    const primaryKeys = input.columns.filter((column) => column.primaryKey).map((column) => this.core.quoteIdentifier(column.name))
    if (primaryKeys.length && primaryChanged) clauses.push(`ADD PRIMARY KEY (${primaryKeys.join(', ')})`)
    for (const index of input.indexes) {
      if (!index.name.trim() || !index.columns.length || index.columns.some((column) => !names.has(column))) {
        return { success: false, message: `索引“${index.name || '未命名'}”设置不正确` }
      }
      const currentIndex = current.indexes.find((item) => item.name === index.name)
      if (currentIndex && indexSignature(currentIndex) === indexSignature(index)) continue
      const type = index.type === 'UNIQUE' ? 'UNIQUE INDEX' : index.type === 'FULLTEXT' ? 'FULLTEXT INDEX' : 'INDEX'
      clauses.push(`ADD ${type} ${this.core.quoteIdentifier(index.name)} (${index.columns.map((column) => this.core.quoteIdentifier(column)).join(', ')})`)
    }
    for (const foreignKey of input.foreignKeys) {
      if (!foreignKey.name || !names.has(foreignKey.column) || !foreignKey.referencedTable || !foreignKey.referencedColumn) {
        return { success: false, message: `外键“${foreignKey.name || '未命名'}”设置不正确` }
      }
      const currentForeignKey = current.foreignKeys.find((item) => item.name === foreignKey.name)
      if (currentForeignKey && foreignKeySignature(currentForeignKey) === foreignKeySignature(foreignKey)) continue
      clauses.push([
        `ADD CONSTRAINT ${this.core.quoteIdentifier(foreignKey.name)}`,
        `FOREIGN KEY (${this.core.quoteIdentifier(foreignKey.column)})`,
        `REFERENCES ${this.core.quoteIdentifier(foreignKey.referencedTable)} (${this.core.quoteIdentifier(foreignKey.referencedColumn)})`,
        `ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate}`
      ].join(' '))
    }

    const connection = this.core.repository.getById(input.connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    const pool = getMysqlPool(connection, input.databaseName)
    try {
      if (clauses.length) await pool.query(`ALTER TABLE ${this.core.quoteIdentifier(input.currentTableName)} ${clauses.join(', ')}`)
      if ((current.tableComment ?? '') !== input.tableComment) {
        await pool.query(`ALTER TABLE ${this.core.quoteIdentifier(input.currentTableName)} COMMENT = ${this.core.quoteString(input.tableComment)}`)
      }
      if (input.tableName !== input.currentTableName) {
        await pool.query(`RENAME TABLE ${this.core.quoteIdentifier(input.currentTableName)} TO ${this.core.quoteIdentifier(input.tableName)}`)
      }
      await this.stats.refreshPersistedDatabaseStats(connection, input.databaseName)
      return { success: true, message: '数据表结构已保存' }
    } catch (error) {
      return { success: false, message: this.core.errorMessage(error) }
    }
  }

  private async executeDatabaseStatement(
    connectionId: number,
    sql: string,
    successMessage: string
  ): Promise<ConnectionActionResult> {
    const connection = this.core.repository.getById(connectionId)
    if (!connection) return { success: false, message: '连接不存在' }
    if (!connection.open) return { success: false, message: '请先打开连接' }
    const pool = getMysqlPool(connection)
    try {
      await pool.query(sql)
      try {
        this.stats.recordQueryRun({
          connectionId,
          connectionName: connection.name,
          engine: connection.engine,
          databaseName: connection.defaultDatabase,
          sql,
          success: true,
          queryCount: 1
        })
        await this.stats.refreshStatsForSql(connection, connection.defaultDatabase, sql, true)
      } catch (recordError) {
        console.warn('记录工作台查询统计失败：', this.core.errorMessage(recordError))
      }
      return { success: true, message: successMessage }
    } catch (error) {
      const message = this.core.errorMessage(error)
      try {
        this.stats.recordQueryRun({
          connectionId,
          connectionName: connection.name,
          engine: connection.engine,
          databaseName: connection.defaultDatabase,
          sql,
          success: false,
          queryCount: 1,
          errorMessage: message
        })
      } catch (recordError) {
        console.warn('记录工作台查询统计失败：', this.core.errorMessage(recordError))
      }
      return { success: false, message }
    }
  }
}
