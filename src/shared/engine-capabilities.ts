/** 数据库对象类型 */
export type DatabaseObjectType =
  | 'tables' | 'views' | 'functions' | 'procedures'
  | 'sequences' | 'extensions' | 'types' | 'domains'
  | 'packages' | 'synonyms' | 'triggers' | 'indexes'
  | 'foreignKeys' | 'checkConstraints' | 'policies'
  | 'materializedViews' | 'foreignTables' | 'events'
  | 'dictionaries' | 'aliases' | 'dataStreams' | 'mappings'

/** 表维护操作 */
export type TableMaintenanceAction =
  | 'analyze' | 'optimize' | 'vacuum' | 'check' | 'reindex'

/** 引擎能力声明 */
export interface EngineCapabilities {
  /** 是否支持 Schema */
  schemas: boolean
  /** 支持的对象类型列表 */
  objectTypes: DatabaseObjectType[]
  /** 表维护操作 */
  maintenance: TableMaintenanceAction[]
  /** 是否支持重命名数据库 */
  supportsRenameDatabase: boolean
  /** 是否支持删除数据库 */
  supportsDropDatabase: boolean
  /** 是否支持进程列表 */
  supportsProcessList: boolean
  /** 标识符引用符 */
  quoteChar: '"' | '`' | '['
  /** 引擎显示名称 */
  displayName: string
}

/** 15 个引擎的能力声明 */
export const engineCapabilities: Record<string, EngineCapabilities> = {
  mysql: {
    schemas: false,
    objectTypes: ['tables', 'views', 'functions', 'procedures', 'triggers', 'indexes', 'foreignKeys', 'checkConstraints'],
    maintenance: ['check', 'optimize', 'analyze'],
    supportsRenameDatabase: true,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '`',
    displayName: 'MySQL'
  },
  mariadb: {
    schemas: false,
    objectTypes: ['tables', 'views', 'functions', 'procedures', 'triggers', 'indexes', 'foreignKeys', 'checkConstraints', 'events'],
    maintenance: ['check', 'optimize', 'analyze'],
    supportsRenameDatabase: true,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '`',
    displayName: 'MariaDB'
  },
  postgresql: {
    schemas: true,
    objectTypes: ['tables', 'views', 'functions', 'procedures', 'sequences', 'extensions', 'types', 'domains', 'triggers', 'indexes', 'foreignKeys', 'checkConstraints', 'policies', 'materializedViews', 'foreignTables'],
    maintenance: ['vacuum', 'analyze', 'reindex'],
    supportsRenameDatabase: false,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '"',
    displayName: 'PostgreSQL'
  },
  sqlite: {
    schemas: false,
    objectTypes: ['tables', 'views', 'triggers', 'indexes'],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: false,
    supportsProcessList: false,
    quoteChar: '"',
    displayName: 'SQLite'
  },
  'sql server': {
    schemas: true,
    objectTypes: ['tables', 'views', 'functions', 'procedures', 'triggers', 'indexes', 'foreignKeys', 'checkConstraints', 'synonyms'],
    maintenance: [],
    supportsRenameDatabase: true,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '[',
    displayName: 'SQL Server'
  },
  oracle: {
    schemas: true,
    objectTypes: ['tables', 'views', 'functions', 'procedures', 'sequences', 'packages', 'triggers', 'indexes', 'foreignKeys', 'checkConstraints', 'materializedViews', 'synonyms'],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '"',
    displayName: 'Oracle'
  },
  tidb: {
    schemas: false,
    objectTypes: ['tables', 'views', 'triggers', 'indexes', 'foreignKeys', 'checkConstraints'],
    maintenance: ['check', 'optimize', 'analyze'],
    supportsRenameDatabase: true,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '`',
    displayName: 'TiDB'
  },
  clickhouse: {
    schemas: false,
    objectTypes: ['tables', 'views', 'functions', 'indexes', 'checkConstraints', 'dictionaries'],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '`',
    displayName: 'ClickHouse'
  },
  mongodb: {
    schemas: false,
    objectTypes: ['tables', 'views', 'indexes'],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '"',
    displayName: 'MongoDB'
  },
  redis: {
    schemas: false,
    objectTypes: [],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: false,
    supportsProcessList: false,
    quoteChar: '"',
    displayName: 'Redis'
  },
  duckdb: {
    schemas: false,
    objectTypes: ['tables', 'views', 'sequences', 'indexes', 'checkConstraints'],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: true,
    supportsProcessList: false,
    quoteChar: '"',
    displayName: 'DuckDB'
  },
  elasticsearch: {
    schemas: false,
    objectTypes: ['aliases', 'dataStreams', 'mappings'],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: false,
    supportsProcessList: false,
    quoteChar: '"',
    displayName: 'Elasticsearch'
  },
  '达梦': {
    schemas: true,
    objectTypes: ['tables', 'views', 'functions', 'procedures', 'sequences', 'packages', 'triggers', 'indexes', 'foreignKeys', 'checkConstraints', 'materializedViews'],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '"',
    displayName: '达梦'
  },
  '人大金仓': {
    schemas: true,
    objectTypes: ['tables', 'views', 'functions', 'sequences', 'triggers', 'indexes', 'foreignKeys', 'checkConstraints', 'materializedViews'],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: true,
    supportsProcessList: true,
    quoteChar: '"',
    displayName: '人大金仓'
  },
  ssh: {
    schemas: false,
    objectTypes: [],
    maintenance: [],
    supportsRenameDatabase: false,
    supportsDropDatabase: false,
    supportsProcessList: false,
    quoteChar: '"',
    displayName: 'SSH'
  }
}

/** 获取引擎能力，未知引擎返回 null */
export function getEngineCapabilities(engine: string): EngineCapabilities | null {
  return engineCapabilities[engine.toLowerCase()] ?? null
}

/** 判断引擎是否支持某对象类型 */
export function engineSupportsObject(engine: string, objectType: DatabaseObjectType): boolean {
  const caps = getEngineCapabilities(engine)
  return caps ? caps.objectTypes.includes(objectType) : false
}

/** 获取引擎的标识符引用符 */
export function getQuoteChar(engine: string): string {
  return getEngineCapabilities(engine)?.quoteChar ?? '"'
}

/** 生成全限定名称 */
export function qualifiedName(engine: string, parts: { database?: string; schema?: string; name: string }): string {
  const q = getQuoteChar(engine)
  const segments: string[] = []
  if (parts.database) segments.push(`${q}${parts.database}${q}`)
  if (parts.schema) segments.push(`${q}${parts.schema}${q}`)
  segments.push(`${q}${parts.name}${q}`)
  return segments.join('.')
}
