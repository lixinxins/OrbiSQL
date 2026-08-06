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

/** SSH 是连接协议而非数据库引擎，与 DatabaseEngine 分离以减少引擎判断分支的复杂度 */
export type ConnectionProtocol = DatabaseEngine | 'SSH'

/** 连接环境标识，用于语义化区分不同环境 */
export type ConnectionEnvironment = 'production' | 'staging' | 'development'

export type AppLanguage = 'zh-CN' | 'en-US'
export type AppTheme = 'system' | 'light' | 'classic'

export interface AppPreferences {
  language: AppLanguage
  theme: AppTheme
}

export interface TableColumn {
  name: string
  type: string        // 数据库原始类型，如 'varchar', 'int', 'text'
  nullable: boolean
  isPrimaryKey: boolean
  comment?: string
}

export interface TableItem {
  name: string
  comment?: string
  columns: TableColumn[]
  indexes: string[]
  foreignKeys: string[]
  checks: string[]
  triggers: string[]
  policies?: string[]
}

export interface SchemaItem {
  name: string
  tables: TableItem[]
  views: string[]
  functions: string[]
  procedures?: string[]
  sequences?: string[]
  materializedViews?: string[]
  extensions?: string[]
  types?: string[]
  domains?: string[]
  foreignTables?: string[]
  triggers?: string[]
}

export interface DatabaseItem {
  name: string
  charset?: string
  collation?: string
  dataBytes?: number
  schemas?: SchemaItem[]
  tables: TableItem[]
  views: string[]
  functions: string[]
  procedures: string[]
  indexes: string[]
  triggers: string[]
  materializedViews?: string[]
  sequences?: string[]
  extensions?: string[]
  types?: string[]
  domains?: string[]
  foreignTables?: string[]
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
  /** 结果集是否被截断（超出单次返回上限） */
  truncated?: boolean
  /** 服务端游标 ID，用于 fetchMore 取后续数据 */
  cursorId?: string
  /** 结果集总行数（仅 SELECT 查询） */
  totalRows?: number
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

export interface TableDataFilterCondition {
  column: string
  operator: TableDataFilterOperator
  value: string
}

export interface TableDataFilter {
  /** 多个筛选条件（支持多字段组合） */
  filters: TableDataFilterCondition[]
  /** 条件组合方式：AND（默认）或 OR */
  logic?: 'AND' | 'OR'
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
  engine: ConnectionProtocol
  host: string
  port: number
  username: string
  defaultDatabase: string
  databases: DatabaseItem[]
  color: string
  environment: ConnectionEnvironment | null
  connected: boolean
  open: boolean
  error?: string
  groupId?: number | null
  groupName?: string
  ssh?: SshConfig
  ssl?: SslConfig
}

export interface WorkspaceStats {
  activeConnections: number
  savedDatabaseConnections: number
  todayQueryCount: number
  todaySuccessfulQueryCount: number
  databaseCount: number
  tableCount: number
  dataObjectCount: number
  dataBytes: number | null
  healthScore: number
  healthStatus: string
  healthSummary: string
  averageLatencyMs: number | null
  failedQueryRate: number
  trend: WorkspaceQueryTrend
  recentQueries: WorkspaceRecentQuery[]
  connectionSummaries: WorkspaceConnectionSummary[]
  updatedAt: string
}

export interface WorkspaceQueryTrend {
  range: '7d' | '30d' | '90d'
  label: string
  subtitle: string
  points: number[]
  labels: string[]
}

export interface WorkspaceRecentQuery {
  id: number
  title: string
  sql: string
  time: string
  success: boolean
}

export interface WorkspaceConnectionSummary {
  id: number
  name: string
  engine: string
  database: string
  latency: string
  color: string
  open: boolean
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
  engine: ConnectionProtocol
  host: string
  port: number
  username: string
  password: string
  defaultDatabase: string
  savePassword: boolean
  color?: string
  environment?: ConnectionEnvironment | null
  groupId?: number | null
  ssh?: SshConfig
  ssl?: SslConfig
}

export interface ConnectionGroup {
  id: number
  name: string
  category: 'database' | 'ssh'
  connectionCount: number
}

export interface UpdateConnectionInput extends CreateConnectionInput {
  id: number
}

export interface ConnectionActionResult {
  success: boolean
  message: string
  connectionId?: number
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

export interface ExportSqlProgress {
  current: number
  total: number
  tableName?: string
  message: string
}

export interface ExportSqlResult extends ConnectionActionResult {
  filePath?: string
  sqlContent?: string
  totalLength?: number
  isTruncated?: boolean
  canceled?: boolean
}

export interface TableColumnPreviewInfo {
  name: string
  type: string
  comment?: string
}

export interface PreviewImportResult {
  success: boolean
  message?: string
  canceled?: boolean
  filePath?: string
  fileName?: string
  fileSize?: number
  totalRows?: number
  fileHeaders?: string[]
  previewRows?: Array<Record<string, unknown>>
  tableColumns?: TableColumnPreviewInfo[]
  initialMapping?: Record<string, string>
  connectionId?: number
  databaseName?: string
  tableName?: string
}

export interface ExecuteImportInput {
  connectionId: number
  databaseName: string
  tableName: string
  filePath: string
  columnMapping: Record<string, string>
  clearTarget?: boolean
}

export interface ExportTableCustomInput {
  connectionId: number
  databaseName: string
  tableName: string
  format: 'csv' | 'json' | 'xlsx'
  selectedColumns?: string[]
  includeHeader?: boolean
  filePath?: string
}

export interface PreviewSqlFileResult {
  success: boolean
  message?: string
  canceled?: boolean
  connectionId?: number
  connectionName?: string
  databaseName?: string
  filePath?: string
  fileName?: string
  fileSize?: number
  totalLines?: number
  statementCount?: number
  sqlPreview?: string
  isTruncated?: boolean
}

export interface ExecuteSqlFileInput {
  connectionId: number
  databaseName?: string
  filePath: string
  continueOnError?: boolean
  inTransaction?: boolean
}

export interface PreviewExportSqlResult {
  success: boolean
  message?: string
  connectionId?: number
  databaseName?: string
  tableName?: string
  includeData?: boolean
  sqlPreview?: string
  tableCount?: number
  tables?: Array<{ name: string; columnsCount?: number; comment?: string }>
}


export interface ProcessItem {
  id: string | number
  user?: string
  host?: string
  db?: string
  command?: string
  time?: number
  state?: string
  info?: string
  raw?: Record<string, unknown>
}

export interface ProcessListResult {
  success: boolean
  message?: string
  processes?: ProcessItem[]
  rawSql?: string
}

export interface KillProcessResult {
  success: boolean
  message: string
}
