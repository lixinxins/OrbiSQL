import { safeStorage } from 'electron'
import type { AiProviderType, AiSaveModelInput, AiStoredModel } from '../../shared/ai-agent'
import type { ConnectionEnvironment, ConnectionGroup, CreateConnectionInput, DatabaseItem, SaveQueryInput, SavedQuery, UpdateConnectionInput, WorkspaceStats } from '../../shared/connections'
import { sshTunnelManager } from '../services/ssh-tunnel-manager'
import { DatabaseSync, type SqliteDatabase } from '../services/sqlite-runtime'

export interface StoredConnection {
  id: number
  name: string
  engine: CreateConnectionInput['engine']
  host: string
  port: number
  username: string
  defaultDatabase: string
  password: string
  savePassword: boolean
  open: boolean
  color?: string
  environment: ConnectionEnvironment | null
  groupId: number | null
  groupName: string
  sshEnabled: boolean
  sshHost: string
  sshPort: number
  sshUsername: string
  sshAuthType: 'password' | 'privateKey'
  sshPassword: string
  sshPrivateKeyPath: string
  sshPassphrase: string
  sslEnabled: boolean
  sslRejectUnauthorized: boolean
  sslCaPath: string
  sslCertPath: string
  sslKeyPath: string
  sortOrder: number
}

interface ConnectionRow {
  id: number
  name: string
  engine: CreateConnectionInput['engine']
  host: string
  port: number
  username: string
  database_name: string
  password_cipher: Uint8Array | null
  save_password: number
  is_open: number
  color: string | null
  environment: string | null
  group_id: number | null
  sort_order: number | null
  group_name: string | null
  ssh_enabled: number
  ssh_host: string
  ssh_port: number
  ssh_username: string
  ssh_auth_type: string
  ssh_password_cipher: Uint8Array | null
  ssh_private_key_path: string
  ssh_passphrase_cipher: Uint8Array | null
  ssl_enabled: number
  ssl_reject_unauthorized: number
  ssl_ca_path: string
  ssl_cert_path: string
  ssl_key_path: string
}

interface SavedQueryRow {
  id: number
  connection_id: number
  database_name: string
  name: string
  sql_text: string
  created_at: string
  updated_at: string
}

interface AiModelRow {
  id: number
  name: string
  provider: AiProviderType
  endpoint: string
  model_name: string
  api_key_cipher: Uint8Array | null
  created_at: string
  updated_at: string
}

export interface StoredAiModel extends AiStoredModel {
  apiKey: string
}

interface QueryRunInput {
  connectionId: number
  connectionName: string
  engine: string
  databaseName: string
  sql: string
  success: boolean
  queryCount: number
  affectedRows?: number
  durationMs?: number
  errorMessage?: string
}

const CURRENT_SCHEMA_VERSION = 10

export class ConnectionRepository {
  private readonly database: SqliteDatabase

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA journal_mode = WAL;')
    this.database.exec('PRAGMA foreign_keys = ON;')

    // schema_version 表与基础表（始终在事务外创建，IF NOT EXISTS 保证幂等）
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 0);
    `)
    this.database.exec(`
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

    // 版本化迁移：事务包裹，崩溃安全
    const version = this.getSchemaVersion()
    if (version < CURRENT_SCHEMA_VERSION) {
      this.database.exec('BEGIN TRANSACTION')
      try {
        if (version < 2) this.migrateToV2()
        if (version < 3) this.migrateToV3()
        if (version < 4) this.migrateToV4()
        if (version < 5) this.migrateToV5()
        if (version < 6) this.migrateToV6()
        if (version < 7) this.migrateToV7()
        if (version < 8) this.migrateToV8()
        if (version < 9) this.migrateToV9()
        if (version < 10) this.migrateToV10()
        this.setSchemaVersion(CURRENT_SCHEMA_VERSION)
        this.database.exec('COMMIT')
      } catch (e) {
        this.database.exec('ROLLBACK')
        throw e
      }
    }

    // 每次启动重置连接状态
    this.database.exec('UPDATE saved_connections SET is_open = 0;')
  }

  // ── Schema version helpers ──────────────────────────────────────────

  private getSchemaVersion(): number {
    const row = this.database.prepare('SELECT version FROM schema_version WHERE id = 1').get() as { version: number } | undefined
    return row?.version ?? 0
  }

  private setSchemaVersion(version: number): void {
    this.database.prepare('UPDATE schema_version SET version = ? WHERE id = 1').run(version)
  }

  // ── Migration steps ─────────────────────────────────────────────────

  /** V2: 添加 is_open、database_name、color 字段 */
  private migrateToV2(): void {
    const columns = this.getTableColumns('saved_connections')
    if (!columns.has('is_open')) {
      this.database.exec('ALTER TABLE saved_connections ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1')
    }
    if (!columns.has('database_name')) {
      this.database.exec("ALTER TABLE saved_connections ADD COLUMN database_name TEXT NOT NULL DEFAULT ''")
    }
    if (!columns.has('color')) {
      this.database.exec("ALTER TABLE saved_connections ADD COLUMN color TEXT NOT NULL DEFAULT ''")
    }
  }

  /** V3: 移除 saved_connections 引擎 CHECK 约束（重建表） */
  private migrateToV3(): void {
    const schema = this.database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'saved_connections'").get() as { sql?: string } | undefined
    if (!schema?.sql?.includes('CHECK (engine IN')) return

    this.database.exec(`
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
  private migrateToV4(): void {
    const columns = this.getTableColumns('saved_connections')
    const addColumn = (name: string, definition: string): void => {
      if (!columns.has(name)) {
        this.database.exec(`ALTER TABLE saved_connections ADD COLUMN ${name} ${definition}`)
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
  private migrateToV5(): void {
    const columns = this.getTableColumns('saved_connections')
    const addColumn = (name: string, definition: string): void => {
      if (!columns.has(name)) {
        this.database.exec(`ALTER TABLE saved_connections ADD COLUMN ${name} ${definition}`)
      }
    }
    addColumn('ssl_enabled', 'INTEGER NOT NULL DEFAULT 0')
    addColumn('ssl_reject_unauthorized', 'INTEGER NOT NULL DEFAULT 1')
    addColumn('ssl_ca_path', "TEXT NOT NULL DEFAULT ''")
    addColumn('ssl_cert_path', "TEXT NOT NULL DEFAULT ''")
    addColumn('ssl_key_path', "TEXT NOT NULL DEFAULT ''")
  }

  /** V6: 创建 saved_queries、ai_models 表并初始化默认模型 */
  private migrateToV6(): void {
    this.database.exec(`
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
    const modelCount = this.database.prepare('SELECT COUNT(*) AS count FROM ai_models').get() as { count: number }
    if (Number(modelCount.count) === 0) {
      const insert = this.database.prepare('INSERT INTO ai_models (name, provider, endpoint, model_name) VALUES (?, ?, ?, ?)')
      insert.run('OpenAI', 'openai-responses', 'https://api.openai.com/v1', 'gpt-5.6-sol')
      insert.run('OpenAI 兼容接口', 'openai-compatible', 'https://api.openai.com/v1', 'gpt-5.6-sol')
      insert.run('Ollama 本地模型', 'ollama', 'http://localhost:11434', 'qwen3')
    }
  }

  /** V7: 添加 environment 字段 */
  private migrateToV7(): void {
    const columns = this.getTableColumns('saved_connections')
    if (!columns.has('environment')) {
      this.database.exec("ALTER TABLE saved_connections ADD COLUMN environment TEXT NOT NULL DEFAULT ''")
    }
  }

  /** V8: connection_groups 添加 category 字段 */
  private migrateToV8(): void {
    const columns = this.getTableColumns('connection_groups')
    if (!columns.has('category')) {
      this.database.exec("ALTER TABLE connection_groups ADD COLUMN category TEXT NOT NULL DEFAULT 'database'")
    }
  }

  /** V9: saved_connections 添加 sort_order 字段 */
  private migrateToV9(): void {
    const columns = this.getTableColumns('saved_connections')
    if (!columns.has('sort_order')) {
      this.database.exec('ALTER TABLE saved_connections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
    }
  }

  /** V10: 工作台真实业务统计 */
  private migrateToV10(): void {
    this.database.exec(`
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

  // ── Utility ─────────────────────────────────────────────────────────

  private getTableColumns(tableName: string): Set<string> {
    const rows = this.database.prepare(`PRAGMA table_info(${tableName})`).all() as unknown as Array<{ name: string }>
    return new Set(rows.map((r) => r.name))
  }

  private countDatabaseTables(database: DatabaseItem): number {
    const tableKeys = new Set<string>()
    database.tables.forEach((table) => tableKeys.add(`default.${table.name}`))
    database.schemas?.forEach((schema) => {
      schema.tables.forEach((table) => tableKeys.add(`${schema.name}.${table.name}`))
    })
    return tableKeys.size
  }

  private countDatabaseObjects(database: DatabaseItem): number {
    const schemaObjectCount = database.schemas?.reduce((sum, schema) =>
      sum
      + schema.tables.length
      + schema.views.length
      + schema.functions.length
      + (schema.procedures?.length ?? 0)
      + (schema.sequences?.length ?? 0)
      + (schema.materializedViews?.length ?? 0)
      + (schema.extensions?.length ?? 0)
      + (schema.types?.length ?? 0)
      + (schema.domains?.length ?? 0)
      + (schema.foreignTables?.length ?? 0)
      + (schema.triggers?.length ?? 0),
    0) ?? 0
    return schemaObjectCount
      + database.tables.length
      + database.views.length
      + database.functions.length
      + database.procedures.length
      + database.indexes.length
      + database.triggers.length
      + (database.materializedViews?.length ?? 0)
      + (database.sequences?.length ?? 0)
      + (database.extensions?.length ?? 0)
      + (database.types?.length ?? 0)
      + (database.domains?.length ?? 0)
      + (database.foreignTables?.length ?? 0)
      + (database.packages?.length ?? 0)
      + (database.synonyms?.length ?? 0)
      + (database.events?.length ?? 0)
      + (database.dictionaries?.length ?? 0)
      + (database.aliases?.length ?? 0)
      + (database.dataStreams?.length ?? 0)
      + (database.mappings?.length ?? 0)
  }

  list(): StoredConnection[] {
    const rows = this.database
      .prepare(`
        SELECT c.id, c.name, c.engine, c.host, c.port, c.username, c.database_name, c.password_cipher, c.save_password, c.is_open, c.color, c.environment,
          c.group_id, g.name AS group_name, COALESCE(c.sort_order, 0) AS sort_order,
          ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_type, ssh_password_cipher, ssh_private_key_path, ssh_passphrase_cipher,
          ssl_enabled, ssl_reject_unauthorized, ssl_ca_path, ssl_cert_path, ssl_key_path
        FROM saved_connections c LEFT JOIN connection_groups g ON g.id = c.group_id
        ORDER BY COALESCE(g.name, ''), COALESCE(c.sort_order, 0) ASC, c.id ASC
      `)
      .all() as unknown as ConnectionRow[]

    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      engine: row.engine,
      host: row.host,
      port: Number(row.port),
      username: row.username,
      defaultDatabase: row.database_name,
      password: this.decryptPassword(row.password_cipher) ?? '',
      savePassword: Boolean(row.save_password),
      open: Boolean(row.is_open),
      color: row.color || undefined,
      environment: (row.environment || null) as ConnectionEnvironment | null,
      groupId: row.group_id == null ? null : Number(row.group_id),
      groupName: row.group_name || '',
      sortOrder: Number(row.sort_order ?? 0),
      sshEnabled: Boolean(row.ssh_enabled),
      sshHost: row.ssh_host,
      sshPort: Number(row.ssh_port),
      sshUsername: row.ssh_username,
      sshAuthType: row.ssh_auth_type === 'privateKey' ? 'privateKey' : 'password',
      sshPassword: this.decryptPassword(row.ssh_password_cipher) ?? '',
      sshPrivateKeyPath: row.ssh_private_key_path,
      sshPassphrase: this.decryptPassword(row.ssh_passphrase_cipher) ?? '',
      sslEnabled: Boolean(row.ssl_enabled),
      sslRejectUnauthorized: Boolean(row.ssl_reject_unauthorized),
      sslCaPath: row.ssl_ca_path,
      sslCertPath: row.ssl_cert_path,
      sslKeyPath: row.ssl_key_path
    }))
  }

  getById(id: number): StoredConnection | null {
    const row = this.database
      .prepare(`
        SELECT c.id, c.name, c.engine, c.host, c.port, c.username, c.database_name, c.password_cipher, c.save_password, c.is_open, c.color, c.environment,
          c.group_id, g.name AS group_name, COALESCE(c.sort_order, 0) AS sort_order,
          ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_type, ssh_password_cipher, ssh_private_key_path, ssh_passphrase_cipher,
          ssl_enabled, ssl_reject_unauthorized, ssl_ca_path, ssl_cert_path, ssl_key_path
        FROM saved_connections c LEFT JOIN connection_groups g ON g.id = c.group_id
        WHERE c.id = ?
      `)
      .get(id) as unknown as ConnectionRow | undefined

    if (!row) return null
    const tunnel = sshTunnelManager.getEndpoint(id)
    return {
      id: Number(row.id),
      name: row.name,
      engine: row.engine,
      host: tunnel?.localHost ?? row.host,
      port: tunnel?.localPort ?? Number(row.port),
      username: row.username,
      defaultDatabase: row.database_name,
      password: this.decryptPassword(row.password_cipher) ?? '',
      savePassword: Boolean(row.save_password),
      open: Boolean(row.is_open),
      color: row.color || undefined,
      environment: (row.environment || null) as ConnectionEnvironment | null,
      groupId: row.group_id == null ? null : Number(row.group_id),
      groupName: row.group_name || '',
      sortOrder: Number(row.sort_order ?? 0),
      sshEnabled: Boolean(row.ssh_enabled),
      sshHost: row.ssh_host,
      sshPort: Number(row.ssh_port),
      sshUsername: row.ssh_username,
      sshAuthType: row.ssh_auth_type === 'privateKey' ? 'privateKey' : 'password',
      sshPassword: this.decryptPassword(row.ssh_password_cipher) ?? '',
      sshPrivateKeyPath: row.ssh_private_key_path,
      sshPassphrase: this.decryptPassword(row.ssh_passphrase_cipher) ?? '',
      sslEnabled: Boolean(row.ssl_enabled),
      sslRejectUnauthorized: Boolean(row.ssl_reject_unauthorized),
      sslCaPath: row.ssl_ca_path,
      sslCertPath: row.ssl_cert_path,
      sslKeyPath: row.ssl_key_path
    }
  }

  create(input: CreateConnectionInput): number {
    const passwordCipher = input.savePassword && input.password
      ? this.encryptPassword(input.password)
      : null
    const sshPasswordCipher = input.ssh?.enabled && input.ssh.authType === 'password' && input.ssh.password
      ? this.encryptPassword(input.ssh.password)
      : null
    const sshPassphraseCipher = input.ssh?.enabled && input.ssh.authType === 'privateKey' && input.ssh.passphrase
      ? this.encryptPassword(input.ssh.passphrase)
      : null

    const result = this.database
      .prepare(`
        INSERT INTO saved_connections (
          name, engine, host, port, username, database_name, password_cipher, save_password, color, environment, group_id,
          ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_type, ssh_password_cipher, ssh_private_key_path, ssh_passphrase_cipher,
          ssl_enabled, ssl_reject_unauthorized, ssl_ca_path, ssl_cert_path, ssl_key_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.name.trim(),
        input.engine,
        input.host.trim(),
        input.port,
        input.username.trim(),
        input.defaultDatabase.trim(),
        passwordCipher,
        input.savePassword ? 1 : 0,
        input.color || '',
        input.environment ?? '',
        input.groupId ?? null,
        input.ssh?.enabled ? 1 : 0,
        input.ssh?.host.trim() || '',
        input.ssh?.port || 22,
        input.ssh?.username.trim() || '',
        input.ssh?.authType || 'password',
        sshPasswordCipher,
        input.ssh?.privateKeyPath?.trim() || '',
        sshPassphraseCipher,
        input.ssl?.enabled ? 1 : 0,
        input.ssl?.rejectUnauthorized === false ? 0 : 1,
        input.ssl?.caPath?.trim() || '',
        input.ssl?.certPath?.trim() || '',
        input.ssl?.keyPath?.trim() || ''
      )

    return Number(result.lastInsertRowid)
  }

  updateSortOrders(orders: Array<{ id: number; sortOrder: number }>): void {
    const stmt = this.database.prepare('UPDATE saved_connections SET sort_order = ? WHERE id = ?')
    this.database.exec('BEGIN TRANSACTION')
    try {
      for (const item of orders) {
        stmt.run(item.sortOrder, item.id)
      }
      this.database.exec('COMMIT')
    } catch (err) {
      this.database.exec('ROLLBACK')
      throw err
    }
  }

  updateColor(id: number, color: string): void {
    this.database.prepare('UPDATE saved_connections SET color=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(color, id)
  }

  updateEnvironment(id: number, environment: ConnectionEnvironment | null): void {
    this.database.prepare('UPDATE saved_connections SET environment=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(environment, id)
  }

  update(input: UpdateConnectionInput): void {
    const current = this.database.prepare(`
      SELECT password_cipher, ssh_password_cipher, ssh_passphrase_cipher FROM saved_connections WHERE id = ?
    `).get(input.id) as unknown as Pick<ConnectionRow, 'password_cipher' | 'ssh_password_cipher' | 'ssh_passphrase_cipher'> | undefined
    if (!current) throw new Error('连接不存在')
    const passwordCipher = !input.savePassword ? null : input.password ? this.encryptPassword(input.password) : current.password_cipher
    const sshPasswordCipher = !input.ssh?.enabled || input.ssh.authType !== 'password'
      ? null : input.ssh.password ? this.encryptPassword(input.ssh.password) : current.ssh_password_cipher
    const sshPassphraseCipher = !input.ssh?.enabled || input.ssh.authType !== 'privateKey'
      ? null : input.ssh.passphrase ? this.encryptPassword(input.ssh.passphrase) : current.ssh_passphrase_cipher
    this.database.prepare(`
      UPDATE saved_connections SET
        name=?,engine=?,host=?,port=?,username=?,database_name=?,password_cipher=?,save_password=?,color=?,environment=?,group_id=?,
        ssh_enabled=?,ssh_host=?,ssh_port=?,ssh_username=?,ssh_auth_type=?,ssh_password_cipher=?,ssh_private_key_path=?,ssh_passphrase_cipher=?,
        ssl_enabled=?,ssl_reject_unauthorized=?,ssl_ca_path=?,ssl_cert_path=?,ssl_key_path=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(
      input.name.trim(), input.engine, input.host.trim(), input.port, input.username.trim(), input.defaultDatabase.trim(),
      passwordCipher, input.savePassword ? 1 : 0, input.color || '', input.environment ?? '', input.groupId ?? null,
      input.ssh?.enabled ? 1 : 0, input.ssh?.host.trim() || '', input.ssh?.port || 22,
      input.ssh?.username.trim() || '', input.ssh?.authType || 'password', sshPasswordCipher,
      input.ssh?.privateKeyPath?.trim() || '', sshPassphraseCipher,
      input.ssl?.enabled ? 1 : 0, input.ssl?.rejectUnauthorized === false ? 0 : 1,
      input.ssl?.caPath?.trim() || '', input.ssl?.certPath?.trim() || '', input.ssl?.keyPath?.trim() || '', input.id
    )
  }

  setOpen(id: number, open: boolean): void {
    this.database.prepare(`
      UPDATE saved_connections SET is_open = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(open ? 1 : 0, id)
  }

  delete(id: number): void {
    this.database.prepare('DELETE FROM saved_connections WHERE id = ?').run(id)
  }

  duplicate(id: number): number {
    const source = this.database.prepare(`
      SELECT name, engine, host, port, username, database_name, password_cipher, save_password, color, environment, group_id,
        ssh_enabled,ssh_host,ssh_port,ssh_username,ssh_auth_type,ssh_password_cipher,ssh_private_key_path,ssh_passphrase_cipher,
        ssl_enabled,ssl_reject_unauthorized,ssl_ca_path,ssl_cert_path,ssl_key_path
      FROM saved_connections WHERE id = ?
    `).get(id) as unknown as Omit<ConnectionRow, 'id' | 'is_open'> | undefined
    if (!source) throw new Error('连接不存在')

    const existingNames = new Set(
      (this.database.prepare('SELECT name FROM saved_connections').all() as unknown as Array<{ name: string }>)
        .map((row) => row.name)
    )
    let copyName = `${source.name} 副本`
    let suffix = 2
    while (existingNames.has(copyName)) copyName = `${source.name} 副本 ${suffix++}`

    const result = this.database.prepare(`
      INSERT INTO saved_connections (
        name, engine, host, port, username, database_name, password_cipher, save_password, color, environment, group_id,
        ssh_enabled,ssh_host,ssh_port,ssh_username,ssh_auth_type,ssh_password_cipher,ssh_private_key_path,ssh_passphrase_cipher,
        ssl_enabled,ssl_reject_unauthorized,ssl_ca_path,ssl_cert_path,ssl_key_path,is_open
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      copyName, source.engine, source.host, source.port, source.username, source.database_name,
      source.password_cipher, source.save_password, source.color, source.environment, source.group_id,
      source.ssh_enabled, source.ssh_host, source.ssh_port, source.ssh_username, source.ssh_auth_type,
      source.ssh_password_cipher, source.ssh_private_key_path, source.ssh_passphrase_cipher,
      source.ssl_enabled, source.ssl_reject_unauthorized, source.ssl_ca_path, source.ssl_cert_path, source.ssl_key_path
    )
    return Number(result.lastInsertRowid)
  }

  listGroups(): ConnectionGroup[] {
    const columns = this.getTableColumns('connection_groups')
    const hasCategory = columns.has('category')
    const sql = hasCategory
      ? `SELECT g.id, g.name, COALESCE(g.category, 'database') AS category, COUNT(c.id) AS connection_count
         FROM connection_groups g LEFT JOIN saved_connections c ON c.group_id = g.id
         GROUP BY g.id, g.name, g.category ORDER BY g.name COLLATE NOCASE`
      : `SELECT g.id, g.name, 'database' AS category, COUNT(c.id) AS connection_count
         FROM connection_groups g LEFT JOIN saved_connections c ON c.group_id = g.id
         GROUP BY g.id, g.name ORDER BY g.name COLLATE NOCASE`
    return (this.database.prepare(sql).all() as unknown as Array<{ id: number; name: string; category?: string; connection_count: number }>).map((row) => ({
      id: Number(row.id),
      name: row.name,
      category: (row.category === 'ssh' ? 'ssh' : 'database') as 'database' | 'ssh',
      connectionCount: Number(row.connection_count)
    }))
  }

  createGroup(name: string, category: 'database' | 'ssh' = 'database'): void {
    const columns = this.getTableColumns('connection_groups')
    if (columns.has('category')) {
      this.database.prepare('INSERT INTO connection_groups (name, category) VALUES (?, ?)').run(name.trim(), category)
    } else {
      this.database.prepare('INSERT INTO connection_groups (name) VALUES (?)').run(name.trim())
    }
  }

  deleteGroup(id: number): void {
    this.database.prepare('DELETE FROM connection_groups WHERE id = ?').run(id)
  }

  renameGroup(id: number, newName: string): void {
    const trimmed = newName.trim()
    if (!trimmed) throw new Error('分组名称不能为空')
    const existing = this.database.prepare('SELECT id, name FROM connection_groups WHERE id = ?').get(id) as { id: number; name: string } | undefined
    if (!existing) throw new Error('分组不存在')
    if (existing.name === trimmed) return
    const duplicate = this.database.prepare('SELECT id FROM connection_groups WHERE name = ? AND id != ?').get(trimmed, id) as { id: number } | undefined
    if (duplicate) throw new Error(`分组名称"${trimmed}"已存在`)
    this.database.prepare('UPDATE connection_groups SET name = ? WHERE id = ?').run(trimmed, id)
  }

  setConnectionGroup(connectionId: number, groupId: number | null): void {
    this.database.prepare('UPDATE saved_connections SET group_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(groupId, connectionId)
  }

  listSavedQueries(connectionId: number, databaseName: string): SavedQuery[] {
    const rows = this.database.prepare(`
      SELECT id, connection_id, database_name, name, sql_text, created_at, updated_at
      FROM saved_queries
      WHERE connection_id = ? AND database_name = ?
      ORDER BY updated_at DESC, id DESC
    `).all(connectionId, databaseName) as unknown as SavedQueryRow[]
    return rows.map((row) => ({
      id: Number(row.id),
      connectionId: Number(row.connection_id),
      databaseName: row.database_name,
      name: row.name,
      sql: row.sql_text,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  saveQuery(input: SaveQueryInput): void {
    this.database.prepare(`
      INSERT INTO saved_queries (connection_id, database_name, name, sql_text)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(connection_id, database_name, name) DO UPDATE SET
        sql_text = excluded.sql_text,
        updated_at = CURRENT_TIMESTAMP
    `).run(input.connectionId, input.databaseName, input.name.trim(), input.sql)
  }

  deleteSavedQuery(id: number, connectionId: number, databaseName: string): boolean {
    const result = this.database.prepare(`
      DELETE FROM saved_queries
      WHERE id = ? AND connection_id = ? AND database_name = ?
    `).run(id, connectionId, databaseName)
    return Number(result.changes) > 0
  }

  recordQueryRun(input: QueryRunInput): void {
    this.database.prepare(`
      INSERT INTO workspace_query_runs (
        connection_id, connection_name, engine, database_name, sql_text, success,
        query_count, affected_rows, duration_ms, error_message, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.connectionId,
      input.connectionName,
      input.engine,
      input.databaseName,
      input.sql,
      input.success ? 1 : 0,
      Math.max(1, Math.trunc(input.queryCount || 1)),
      input.affectedRows ?? null,
      input.durationMs ?? null,
      input.errorMessage ?? '',
      new Date().toISOString()
    )
  }

  replaceDatabaseStats(connection: StoredConnection, databases: DatabaseItem[]): void {
    const deleteStatement = this.database.prepare('DELETE FROM workspace_database_stats WHERE connection_id = ? AND database_name = ?')
    const insertStatement = this.database.prepare(`
      INSERT INTO workspace_database_stats (
        connection_id, database_name, engine, table_count, view_count, function_count,
        procedure_count, object_count, estimated_data_bytes, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)
    this.database.exec('BEGIN TRANSACTION')
    try {
      for (const database of databases) {
        const tableCount = this.countDatabaseTables(database)
        const viewCount = database.views.length + (database.schemas?.reduce((sum, schema) => sum + schema.views.length + (schema.materializedViews?.length ?? 0), 0) ?? 0)
        const functionCount = database.functions.length + (database.schemas?.reduce((sum, schema) => sum + schema.functions.length, 0) ?? 0)
        const procedureCount = database.procedures.length + (database.schemas?.reduce((sum, schema) => sum + (schema.procedures?.length ?? 0), 0) ?? 0)
        deleteStatement.run(connection.id, database.name)
        insertStatement.run(
          connection.id,
          database.name,
          connection.engine,
          tableCount,
          viewCount,
          functionCount,
          procedureCount,
          this.countDatabaseObjects(database),
          database.dataBytes == null ? null : Math.max(0, Math.trunc(database.dataBytes))
        )
      }
      this.database.exec('COMMIT')
    } catch (err) {
      this.database.exec('ROLLBACK')
      throw err
    }
  }

  removeDatabaseStats(connectionId: number, databaseName: string): void {
    this.database.prepare('DELETE FROM workspace_database_stats WHERE connection_id = ? AND database_name = ?').run(connectionId, databaseName)
  }

  getWorkspaceStats(range: '7d' | '30d' | '90d' = '7d'): WorkspaceStats {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayStartIso = startOfToday.toISOString()
    const connections = this.database.prepare(`
      SELECT
        SUM(CASE WHEN is_open = 1 AND engine <> 'SSH' THEN 1 ELSE 0 END) AS activeConnections,
        SUM(CASE WHEN engine <> 'SSH' THEN 1 ELSE 0 END) AS savedDatabaseConnections
      FROM saved_connections
    `).get() as unknown as { activeConnections: number | null; savedDatabaseConnections: number | null }
    const queries = this.database.prepare(`
      SELECT
        COALESCE(SUM(query_count), 0) AS todayQueryCount,
        COALESCE(SUM(CASE WHEN success = 1 THEN query_count ELSE 0 END), 0) AS todaySuccessfulQueryCount
      FROM workspace_query_runs
      WHERE executed_at >= ?
    `).get(todayStartIso) as unknown as { todayQueryCount: number | null; todaySuccessfulQueryCount: number | null }
    const databaseStats = this.database.prepare(`
      SELECT
        COUNT(*) AS databaseCount,
        COALESCE(SUM(table_count), 0) AS tableCount,
        COALESCE(SUM(object_count), 0) AS dataObjectCount,
        SUM(estimated_data_bytes) AS dataBytes
      FROM workspace_database_stats
    `).get() as unknown as { databaseCount: number | null; tableCount: number | null; dataObjectCount: number | null; dataBytes: number | null }
    const recentQueries = (this.database.prepare(`
      SELECT id, sql_text, success, executed_at
      FROM workspace_query_runs
      ORDER BY executed_at DESC, id DESC
      LIMIT 5
    `).all() as unknown as Array<{ id: number; sql_text: string; success: number; executed_at: string }>).map((row) => ({
      id: Number(row.id),
      title: this.queryTitle(row.sql_text),
      sql: row.sql_text,
      time: this.relativeTime(row.executed_at),
      success: Boolean(row.success)
    }))
    const connectionSummaries = (this.database.prepare(`
      SELECT id, name, engine, database_name, color, is_open
      FROM saved_connections
      WHERE engine <> 'SSH'
      ORDER BY is_open DESC, updated_at DESC, id DESC
      LIMIT 4
    `).all() as unknown as Array<{ id: number; name: string; engine: string; database_name: string; color: string | null; is_open: number }>).map((row) => ({
      id: Number(row.id),
      name: row.name,
      engine: row.engine,
      database: row.database_name || 'default',
      latency: '未采集',
      color: row.color || '#347ff0',
      open: Boolean(row.is_open)
    }))
    const healthStart = new Date()
    healthStart.setDate(healthStart.getDate() - 7)
    const recentHealth = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed,
        AVG(duration_ms) AS averageLatencyMs
      FROM workspace_query_runs
      WHERE executed_at >= ?
    `).get(healthStart.toISOString()) as unknown as { total: number | null; failed: number | null; averageLatencyMs: number | null }
    const totalHealthQueries = Number(recentHealth.total ?? 0)
    const failedQueryRate = totalHealthQueries > 0 ? Number(recentHealth.failed ?? 0) / totalHealthQueries : 0
    const healthScore = Math.max(0, Math.min(100, Math.round(100 - failedQueryRate * 100 - (Number(recentHealth.averageLatencyMs ?? 0) > 1000 ? 8 : 0))))
    const healthStatus = healthScore >= 90 ? '运行状态优秀' : healthScore >= 75 ? '运行状态良好' : healthScore >= 60 ? '运行状态需关注' : '运行状态异常'
    return {
      activeConnections: Number(connections.activeConnections ?? 0),
      savedDatabaseConnections: Number(connections.savedDatabaseConnections ?? 0),
      todayQueryCount: Number(queries.todayQueryCount ?? 0),
      todaySuccessfulQueryCount: Number(queries.todaySuccessfulQueryCount ?? 0),
      databaseCount: Number(databaseStats.databaseCount ?? 0),
      tableCount: Number(databaseStats.tableCount ?? 0),
      dataObjectCount: Number(databaseStats.dataObjectCount ?? 0),
      dataBytes: databaseStats.dataBytes == null ? null : Number(databaseStats.dataBytes),
      healthScore,
      healthStatus,
      healthSummary: totalHealthQueries > 0
        ? `近 7 天执行 ${totalHealthQueries.toLocaleString('zh-CN')} 次，失败率 ${(failedQueryRate * 100).toFixed(2)}%。`
        : '暂无查询执行记录，连接打开后会自动累计运行状态。',
      averageLatencyMs: recentHealth.averageLatencyMs == null ? null : Math.round(Number(recentHealth.averageLatencyMs)),
      failedQueryRate,
      trend: this.getQueryTrend(range),
      recentQueries,
      connectionSummaries,
      updatedAt: new Date().toISOString()
    }
  }

  private getQueryTrend(range: '7d' | '30d' | '90d'): WorkspaceStats['trend'] {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - days + 1)
    const rows = this.database.prepare(`
      SELECT substr(executed_at, 1, 10) AS day, COALESCE(SUM(query_count), 0) AS count
      FROM workspace_query_runs
      WHERE executed_at >= ?
      GROUP BY substr(executed_at, 1, 10)
      ORDER BY day ASC
    `).all(start.toISOString()) as unknown as Array<{ day: string; count: number }>
    const countsByDay = new Map(rows.map((row) => [row.day, Number(row.count)]))
    const allPoints = Array.from({ length: days }, (_, index) => {
      const date = new Date(start)
      date.setDate(start.getDate() + index)
      const key = date.toISOString().slice(0, 10)
      return { date, count: countsByDay.get(key) ?? 0 }
    })
    const maxPoints = range === '7d' ? 7 : range === '30d' ? 10 : 12
    const step = Math.ceil(allPoints.length / maxPoints)
    const sampled = allPoints.filter((_, index) => index % step === 0 || index === allPoints.length - 1).slice(-maxPoints)
    const total = allPoints.reduce((sum, item) => sum + item.count, 0)
    return {
      range,
      label: range === '7d' ? '最近 7 天' : range === '30d' ? '最近 30 天' : '最近 90 天',
      subtitle: `过去 ${days} 天共执行 ${total.toLocaleString('zh-CN')} 条查询`,
      points: sampled.map((item) => item.count),
      labels: sampled.map((item) => range === '90d' ? `${item.date.getMonth() + 1}月` : `${item.date.getDate()}日`)
    }
  }

  private queryTitle(sql: string): string {
    const firstWord = sql.trim().split(/\s+/)[0]?.toUpperCase() || 'SQL'
    const titleMap: Record<string, string> = {
      SELECT: '查询数据',
      INSERT: '新增数据',
      UPDATE: '更新数据',
      DELETE: '删除数据',
      CREATE: '创建结构',
      DROP: '删除结构',
      ALTER: '修改结构',
      TRUNCATE: '清空数据'
    }
    return titleMap[firstWord] ?? `${firstWord} 语句`
  }

  private relativeTime(value: string): string {
    const timestamp = new Date(value).getTime()
    if (!Number.isFinite(timestamp)) return value
    const diffMs = Date.now() - timestamp
    const minute = 60_000
    const hour = 60 * minute
    const day = 24 * hour
    if (diffMs < minute) return '刚刚'
    if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`
    if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`
    return new Date(value).toLocaleDateString('zh-CN')
  }

  listAiModels(): StoredAiModel[] {
    const rows = this.database.prepare(`
      SELECT id, name, provider, endpoint, model_name, api_key_cipher, created_at, updated_at
      FROM ai_models ORDER BY updated_at DESC, id ASC
    `).all() as unknown as AiModelRow[]
    return rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      provider: row.provider,
      endpoint: row.endpoint,
      model: row.model_name,
      apiKey: this.decryptPassword(row.api_key_cipher) ?? '',
      hasApiKey: Boolean(row.api_key_cipher),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  getAiModel(id: number): StoredAiModel | null {
    const row = this.database.prepare(
      'SELECT id, name, provider, endpoint, model_name, api_key_cipher, created_at, updated_at FROM ai_models WHERE id = ?'
    ).get(id) as unknown as AiModelRow | undefined
    if (!row) return null
    return {
      id: Number(row.id),
      name: row.name,
      provider: row.provider,
      endpoint: row.endpoint,
      model: row.model_name,
      apiKey: this.decryptPassword(row.api_key_cipher) ?? '',
      hasApiKey: Boolean(row.api_key_cipher),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  saveAiModel(input: AiSaveModelInput): StoredAiModel {
    const current = input.id ? this.getAiModel(input.id) : null
    const existingCipher = current?.hasApiKey
      ? (this.database.prepare('SELECT api_key_cipher FROM ai_models WHERE id = ?').get(input.id!) as unknown as { api_key_cipher: Uint8Array | null }).api_key_cipher
      : null
    const apiKeyCipher = input.apiKey?.trim() ? this.encryptPassword(input.apiKey.trim()) : existingCipher
    if (input.id) {
      this.database.prepare(`
        UPDATE ai_models SET name = ?, provider = ?, endpoint = ?, model_name = ?, api_key_cipher = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(input.name.trim(), input.provider, input.endpoint.trim(), input.model.trim(), apiKeyCipher, input.id)
      const saved = this.getAiModel(input.id)
      if (!saved) throw new Error('模型配置不存在')
      return saved
    }
    const result = this.database.prepare(`
      INSERT INTO ai_models (name, provider, endpoint, model_name, api_key_cipher) VALUES (?, ?, ?, ?, ?)
    `).run(input.name.trim(), input.provider, input.endpoint.trim(), input.model.trim(), apiKeyCipher)
    return this.getAiModel(Number(result.lastInsertRowid))!
  }

  deleteAiModel(id: number): boolean {
    return Number(this.database.prepare('DELETE FROM ai_models WHERE id = ?').run(id).changes) > 0
  }

  private encryptPassword(password: string): Buffer {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法安全保存密码，请取消“保存密码”后重试')
    }
    return safeStorage.encryptString(password)
  }

  private decryptPassword(cipher: Uint8Array | null): string | undefined {
    if (!cipher) return undefined
    if (!safeStorage.isEncryptionAvailable()) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(cipher))
    } catch (e) {
      console.error('[Repository] 密码解密失败:', e)
      return undefined
    }
  }
}
