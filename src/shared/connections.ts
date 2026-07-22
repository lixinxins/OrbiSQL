export type DatabaseEngine =
  | 'MySQL'
  | 'MariaDB'
  | 'PostgreSQL'
  | 'SQLite'
  | 'SQL Server'
  | 'Oracle'
  | 'TiDB'
  | 'ClickHouse'
  | 'MongoDB'
  | 'Redis'
  | 'DuckDB'
  | 'Elasticsearch'
  | '达梦'
  | '人大金仓'

export type AppLanguage = 'zh-CN' | 'en-US'
export type AppTheme = 'system' | 'light' | 'classic' | 'slate' | 'violet'

export interface AppPreferences {
  language: AppLanguage
  theme: AppTheme
}

export interface TableItem {
  name: string
  comment?: string
  columns: string[]
  indexes: string[]
  foreignKeys: string[]
  checks: string[]
  triggers: string[]
}

export interface DatabaseItem {
  name: string
  charset?: string
  collation?: string
  tables: TableItem[]
  views: string[]
  functions: string[]
  procedures: string[]
  indexes: string[]
  triggers: string[]
  materializedViews?: string[]
  sequences?: string[]
  packages?: string[]
  synonyms?: string[]
  events?: string[]
  dictionaries?: string[]
  aliases?: string[]
  dataStreams?: string[]
  mappings?: string[]
}

export interface DatabaseDefinitionInput {
  connectionId: number
  name: string
  charset: string
  collation: string
}

export interface UpdateDatabaseInput extends DatabaseDefinitionInput {
  currentName: string
}

export interface DatabaseCharset {
  name: string
  description: string
  defaultCollation: string
  collations: string[]
}

export interface DatabaseCharsetResult extends ConnectionActionResult {
  charsets?: DatabaseCharset[]
}

export interface QueryExecutionResult extends ConnectionActionResult {
  columns?: string[]
  rows?: Array<Record<string, unknown>>
  affectedRows?: number
  editable?: QueryEditableMetadata
  startTime?: string
  endTime?: string
  durationMs?: number
  queryCount?: number
  errorCount?: number
  successCount?: number
  statementResults?: QueryStatementResult[]
  failedStatementIndex?: number
}

export interface QueryStatementResult {
  index: number
  sql: string
  success: boolean
  message: string
  affectedRows?: number
  columns?: string[]
  rows?: Array<Record<string, unknown>>
  durationMs: number
}

export interface QueryEditableColumn {
  resultName: string
  sourceName: string
  primaryKey: boolean
}

export interface QueryEditableMetadata {
  tableName: string
  primaryKeys: string[]
  columns: QueryEditableColumn[]
}

export interface QueryUpdateRowInput {
  connectionId: number
  databaseName: string
  tableName: string
  primaryKeyValues: Record<string, unknown>
  changes: Record<string, unknown>
}

export interface QueryDeleteRowInput {
  connectionId: number
  databaseName: string
  tableName: string
  primaryKeyValues: Record<string, unknown>
}

export interface CopyTableInput {
  connectionId: number
  databaseName: string
  sourceTableName: string
  targetTableName: string
  targetDatabaseName?: string
  includeData: boolean
}

export interface TransferTableDataInput {
  sourceConnectionId: number
  sourceDatabaseName: string
  sourceTableName: string
  targetConnectionId: number
  targetDatabaseName: string
  targetTableName: string
  clearTarget: boolean
}

export interface RenameTableInput {
  connectionId: number
  databaseName: string
  currentTableName: string
  newTableName: string
}

export type TableDataFilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'startsWith'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'isEmpty'
  | 'isEmptyOrNull'
  | 'isNotEmpty'
  | 'isNull'
  | 'isNotNull'

export interface TableDataFilter {
  column: string
  operator: TableDataFilterOperator
  value: string
}

export type MySQLColumnType =
  | 'CHAR'
  | 'VARCHAR'
  | 'BINARY'
  | 'VARBINARY'
  | 'TINYINT'
  | 'SMALLINT'
  | 'MEDIUMINT'
  | 'INT'
  | 'BIGINT'
  | 'DECIMAL'
  | 'FLOAT'
  | 'DOUBLE'
  | 'BIT'
  | 'TINYTEXT'
  | 'TEXT'
  | 'MEDIUMTEXT'
  | 'LONGTEXT'
  | 'TINYBLOB'
  | 'BLOB'
  | 'MEDIUMBLOB'
  | 'LONGBLOB'
  | 'DATETIME'
  | 'TIMESTAMP'
  | 'DATE'
  | 'TIME'
  | 'YEAR'
  | 'BOOLEAN'
  | 'JSON'
  | 'ENUM'
  | 'SET'
  | 'UUID'
  | 'JSONB'
  | 'INET'
  | 'CIDR'
  | 'MACADDR'
  | 'BYTEA'
  | 'HSTORE'

export interface TableColumnDefinition {
  name: string
  originalName?: string
  type: MySQLColumnType
  typeDefinition?: string
  length: string
  decimals: string
  notNull: boolean
  primaryKey: boolean
  comment: string
  defaultValue?: string | null
  extra?: string
  autoIncrement?: boolean
}

export interface TableIndexDefinition {
  name: string
  type: 'INDEX' | 'UNIQUE' | 'FULLTEXT'
  columns: string[]
}

export interface TableForeignKeyDefinition {
  name: string
  column: string
  referencedTable: string
  referencedColumn: string
  onDelete: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION'
  onUpdate: 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'NO ACTION'
}

export interface CreateTableInput {
  connectionId: number
  databaseName: string
  tableName: string
  tableComment: string
  columns: TableColumnDefinition[]
  indexes: TableIndexDefinition[]
  foreignKeys: TableForeignKeyDefinition[]
}

export interface UpdateTableInput extends CreateTableInput {
  currentTableName: string
}

export interface TableDefinitionResult extends ConnectionActionResult {
  tableName?: string
  tableComment?: string
  columns?: TableColumnDefinition[]
  indexes?: TableIndexDefinition[]
  foreignKeys?: TableForeignKeyDefinition[]
}

export interface DatabaseConnection {
  id: number
  name: string
  engine: DatabaseEngine
  host: string
  port: number
  username: string
  defaultDatabase: string
  databases: DatabaseItem[]
  color: string
  connected: boolean
  open: boolean
  error?: string
  groupId?: number | null
  groupName?: string
  ssh?: SshConfig
  ssl?: SslConfig
}

export interface SshConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  authType: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

export interface SslConfig {
  enabled: boolean
  rejectUnauthorized: boolean
  caPath?: string
  certPath?: string
  keyPath?: string
}

export type ConnectionSecurityFileKind = 'sshPrivateKey' | 'sslCa' | 'sslCert' | 'sslKey'

export interface CreateConnectionInput {
  name: string
  engine: 'MySQL' | 'PostgreSQL' | 'SQLite'
  host: string
  port: number
  username: string
  password: string
  defaultDatabase: string
  savePassword: boolean
  color?: string
  groupId?: number | null
  ssh?: SshConfig
  ssl?: SslConfig
}

export interface ConnectionGroup {
  id: number
  name: string
  connectionCount: number
}

export interface UpdateConnectionInput extends CreateConnectionInput {
  id: number
}

export interface ConnectionActionResult {
  success: boolean
  message: string
}

export interface SavedQuery {
  id: number
  connectionId: number
  databaseName: string
  name: string
  sql: string
  createdAt: string
  updatedAt: string
}

export interface SaveQueryInput {
  connectionId: number
  databaseName: string
  name: string
  sql: string
}
