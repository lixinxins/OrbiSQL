import type { SqliteDatabase } from '../services/sqlite-runtime'

export const CURRENT_SCHEMA_VERSION = 10

/**
 * 读取表的列名集合，供迁移与分组查询做能力探测。
 */
export function getTableColumns(database: SqliteDatabase, tableName: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as unknown as Array<{ name: string }>
  return new Set(rows.map((r) => r.name))
}

/**
 * 建库初始化：pragma + schema_version 表与基础表。
 * 始终在事务外执行，IF NOT EXISTS 保证幂等。
 */
export function initializeSchema(database: SqliteDatabase): void {
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec('PRAGMA foreign_keys = ON;')

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0);
  `)
  database.exec(`
    CREATE TABLE IF NOT EXISTS connection_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'database',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS saved_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      engine TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      database_name TEXT NOT NULL DEFAULT '',
      password_cipher BLOB,
      save_password INTEGER NOT NULL DEFAULT 0,
      is_open INTEGER NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '',
      group_id INTEGER REFERENCES connection_groups(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      ssh_enabled INTEGER NOT NULL DEFAULT 0,
      ssh_host TEXT NOT NULL DEFAULT '',
      ssh_port INTEGER NOT NULL DEFAULT 22,
      ssh_username TEXT NOT NULL DEFAULT '',
      ssh_auth_type TEXT NOT NULL DEFAULT 'password',
      ssh_password_cipher BLOB,
      ssh_private_key_path TEXT NOT NULL DEFAULT '',
      ssh_passphrase_cipher BLOB,
      ssl_enabled INTEGER NOT NULL DEFAULT 0,
      ssl_reject_unauthorized INTEGER NOT NULL DEFAULT 1,
      ssl_ca_path TEXT NOT NULL DEFAULT '',
      ssl_cert_path TEXT NOT NULL DEFAULT '',
      ssl_key_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS saved_connections_unique_name
      ON saved_connections(name);
  `)
}

function getSchemaVersion(database: SqliteDatabase): number {
  const row = database.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number } | undefined
  return row?.version ?? 0
}

function setSchemaVersion(database: SqliteDatabase, version: number): void {
  database.prepare('UPDATE schema_version SET version = ? WHERE id = 1').run(version)
}

/** V2: 添加 is_open、database_name、color 字段 */
function migrateToV2(database: SqliteDatabase): void {
  const columns = getTableColumns(database, 'saved_connections')
  if (!columns.has('is_open')) {
    database.exec('ALTER TABLE saved_connections ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1')
  }
  if (!columns.has('database_name')) {
    database.exec("ALTER TABLE saved_connections ADD COLUMN database_name TEXT NOT NULL DEFAULT ''")
  }
  if (!columns.has('color')) {
    database.exec("ALTER TABLE saved_connections ADD COLUMN color TEXT NOT NULL DEFAULT ''")
  }
}

/** V3: 移除 saved_connections 引擎 CHECK 约束（重建表） */
function migrateToV3(database: SqliteDatabase): void {
  const schema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'saved_connections'").get() as { sql?: string } | undefined
  if (!schema?.sql?.includes('CHECK (engine IN')) return

  database.exec(`
    PRAGMA foreign_keys = OFF;
    DROP INDEX IF EXISTS saved_connections_unique_name;
    ALTER TABLE saved_connections RENAME TO saved_connections_legacy_check;
    CREATE TABLE saved_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      engine TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      database_name TEXT NOT NULL DEFAULT '',
      password_cipher BLOB,
      save_password INTEGER NOT NULL DEFAULT 0,
      is_open INTEGER NOT NULL DEFAULT 1,
      color TEXT NOT NULL DEFAULT '',
      group_id INTEGER REFERENCES connection_groups(id) ON DELETE SET NULL,
      ssh_enabled INTEGER NOT NULL DEFAULT 0,
      ssh_host TEXT NOT NULL DEFAULT '',
      ssh_port INTEGER NOT NULL DEFAULT 22,
      ssh_username TEXT NOT NULL DEFAULT '',
      ssh_auth_type TEXT NOT NULL DEFAULT 'password',
      ssh_password_cipher BLOB,
      ssh_private_key_path TEXT NOT NULL DEFAULT '',
      ssh_passphrase_cipher BLOB,
      ssl_enabled INTEGER NOT NULL DEFAULT 0,
      ssl_reject_unauthorized INTEGER NOT NULL DEFAULT 1,
      ssl_ca_path TEXT NOT NULL DEFAULT '',
      ssl_cert_path TEXT NOT NULL DEFAULT '',
      ssl_key_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO saved_connections
      (id, name, engine, host, port, username, database_name, password_cipher, save_password, is_open, color, group_id, ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_type, ssh_password_cipher, ssh_private_key_path, ssh_passphrase_cipher, ssl_enabled, ssl_reject_unauthorized, ssl_ca_path, ssl_cert_path, ssl_key_path, created_at, updated_at)
    SELECT id, name, engine, host, port, username, database_name, password_cipher, save_password, is_open, color, group_id, ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_type, ssh_password_cipher, ssh_private_key_path, ssh_passphrase_cipher, ssl_enabled, ssl_reject_unauthorized, ssl_ca_path, ssl_cert_path, ssl_key_path, created_at, updated_at
    FROM saved_connections_legacy_check;
    DROP TABLE saved_connections_legacy_check;
    CREATE UNIQUE INDEX saved_connections_unique_name ON saved_connections(name);
    PRAGMA foreign_keys = ON;
  `)
}

/** V4: 添加 SSH 相关字段 */
function migrateToV4(database: SqliteDatabase): void {
  const columns = getTableColumns(database, 'saved_connections')
  const addColumn = (name: string, definition: string): void => {
    if (!columns.has(name)) {
      database.exec(`ALTER TABLE saved_connections ADD COLUMN ${name} ${definition}`)
    }
  }
  addColumn('ssh_enabled', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('group_id', 'INTEGER REFERENCES connection_groups(id) ON DELETE SET NULL')
  addColumn('ssh_host', "TEXT NOT NULL DEFAULT ''")
  addColumn('ssh_port', 'INTEGER NOT NULL DEFAULT 22')
  addColumn('ssh_username', "TEXT NOT NULL DEFAULT ''")
  addColumn('ssh_auth_type', "TEXT NOT NULL DEFAULT 'password'")
  addColumn('ssh_password_cipher', 'BLOB')
  addColumn('ssh_private_key_path', "TEXT NOT NULL DEFAULT ''")
  addColumn('ssh_passphrase_cipher', 'BLOB')
}

/** V5: 添加 SSL 相关字段 */
function migrateToV5(database: SqliteDatabase): void {
  const columns = getTableColumns(database, 'saved_connections')
  const addColumn = (name: string, definition: string): void => {
    if (!columns.has(name)) {
      database.exec(`ALTER TABLE saved_connections ADD COLUMN ${name} ${definition}`)
    }
  }
  addColumn('ssl_enabled', 'INTEGER NOT NULL DEFAULT 0')
  addColumn('ssl_reject_unauthorized', 'INTEGER NOT NULL DEFAULT 1')
  addColumn('ssl_ca_path', "TEXT NOT NULL DEFAULT ''")
  addColumn('ssl_cert_path', "TEXT NOT NULL DEFAULT ''")
  addColumn('ssl_key_path', "TEXT NOT NULL DEFAULT ''")
}

/** V6: 创建 saved_queries、ai_models 表并初始化默认模型 */
function migrateToV6(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS saved_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL REFERENCES saved_connections(id) ON DELETE CASCADE,
      database_name TEXT NOT NULL,
      name TEXT NOT NULL,
      sql_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS saved_queries_unique_name
      ON saved_queries(connection_id, database_name, name);

    CREATE TABLE IF NOT EXISTS ai_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      model_name TEXT NOT NULL,
      api_key_cipher BLOB,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)
  const modelCount = database.prepare('SELECT COUNT(*) AS count FROM ai_models').get() as { count: number }
  if (Number(modelCount.count) === 0) {
    const insert = database.prepare('INSERT INTO ai_models (name, provider, endpoint, model_name) VALUES (?, ?, ?, ?)')
    insert.run('OpenAI', 'openai-responses', 'https://api.openai.com/v1', 'gpt-5.6-sol')
    insert.run('OpenAI 兼容接口', 'openai-compatible', 'https://api.openai.com/v1', 'gpt-5.6-sol')
    insert.run('Ollama 本地模型', 'ollama', 'http://localhost:11434', 'qwen3')
  }
}

/** V7: 添加 environment 字段 */
function migrateToV7(database: SqliteDatabase): void {
  const columns = getTableColumns(database, 'saved_connections')
  if (!columns.has('environment')) {
    database.exec("ALTER TABLE saved_connections ADD COLUMN environment TEXT NOT NULL DEFAULT ''")
  }
}

/** V8: connection_groups 添加 category 字段 */
function migrateToV8(database: SqliteDatabase): void {
  const columns = getTableColumns(database, 'connection_groups')
  if (!columns.has('category')) {
    database.exec("ALTER TABLE connection_groups ADD COLUMN category TEXT NOT NULL DEFAULT 'database'")
  }
}

/** V9: saved_connections 添加 sort_order 字段 */
function migrateToV9(database: SqliteDatabase): void {
  const columns = getTableColumns(database, 'saved_connections')
  if (!columns.has('sort_order')) {
    database.exec('ALTER TABLE saved_connections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
  }
}

/** V10: 工作台真实业务统计 */
function migrateToV10(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS workspace_query_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER REFERENCES saved_connections(id) ON DELETE SET NULL,
      connection_name TEXT NOT NULL DEFAULT '',
      engine TEXT NOT NULL DEFAULT '',
      database_name TEXT NOT NULL DEFAULT '',
      sql_text TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 0,
      query_count INTEGER NOT NULL DEFAULT 1,
      affected_rows INTEGER,
      duration_ms INTEGER,
      error_message TEXT NOT NULL DEFAULT '',
      executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS workspace_query_runs_executed_at
      ON workspace_query_runs(executed_at);
    CREATE INDEX IF NOT EXISTS workspace_query_runs_connection
      ON workspace_query_runs(connection_id, database_name);

    CREATE TABLE IF NOT EXISTS workspace_database_stats (
      connection_id INTEGER NOT NULL REFERENCES saved_connections(id) ON DELETE CASCADE,
      database_name TEXT NOT NULL,
      engine TEXT NOT NULL DEFAULT '',
      table_count INTEGER NOT NULL DEFAULT 0,
      view_count INTEGER NOT NULL DEFAULT 0,
      function_count INTEGER NOT NULL DEFAULT 0,
      procedure_count INTEGER NOT NULL DEFAULT 0,
      object_count INTEGER NOT NULL DEFAULT 0,
      estimated_data_bytes INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (connection_id, database_name)
    );
  `)
}

/**
 * 版本化迁移：事务包裹，崩溃安全。
 * 迁移完成后重置连接打开状态，保证每次启动均为关闭态。
 */
export function runMigrations(database: SqliteDatabase): void {
  const version = getSchemaVersion(database)
  if (version < CURRENT_SCHEMA_VERSION) {
    database.exec('BEGIN TRANSACTION')
    try {
      if (version < 2) migrateToV2(database)
      if (version < 3) migrateToV3(database)
      if (version < 4) migrateToV4(database)
      if (version < 5) migrateToV5(database)
      if (version < 6) migrateToV6(database)
      if (version < 7) migrateToV7(database)
      if (version < 8) migrateToV8(database)
      if (version < 9) migrateToV9(database)
      if (version < 10) migrateToV10(database)
      setSchemaVersion(database, CURRENT_SCHEMA_VERSION)
      database.exec('COMMIT')
    } catch (e) {
      database.exec('ROLLBACK')
      throw e
    }
  }

  // 每次启动重置连接状态
  database.exec('UPDATE saved_connections SET is_open = 0;')
}
