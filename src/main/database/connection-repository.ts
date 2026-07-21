import { safeStorage } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import type { AiProviderType, AiSaveModelInput, AiStoredModel } from '../../shared/ai-agent'
import type { CreateConnectionInput, SaveQueryInput, SavedQuery, UpdateConnectionInput } from '../../shared/connections'

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

export class ConnectionRepository {
  private readonly database: DatabaseSync

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS saved_connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        engine TEXT NOT NULL CHECK (engine IN ('MySQL', 'PostgreSQL', 'SQLite')),
        host TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT NOT NULL,
        database_name TEXT NOT NULL DEFAULT '',
        password_cipher BLOB,
        save_password INTEGER NOT NULL DEFAULT 0,
        is_open INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS saved_connections_unique_name
        ON saved_connections(name);

    `)

    const columns = this.database.prepare('PRAGMA table_info(saved_connections)').all() as unknown as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'is_open')) {
      this.database.exec('ALTER TABLE saved_connections ADD COLUMN is_open INTEGER NOT NULL DEFAULT 1')
    }
    if (!columns.some((column) => column.name === 'database_name')) {
      this.database.exec("ALTER TABLE saved_connections ADD COLUMN database_name TEXT NOT NULL DEFAULT ''")
    }
    const schema = this.database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'saved_connections'").get() as { sql?: string } | undefined
    if (schema?.sql?.includes("engine IN ('MySQL')")) {
      this.database.exec(`
        DROP INDEX IF EXISTS saved_connections_unique_name;
        ALTER TABLE saved_connections RENAME TO saved_connections_legacy;
        CREATE TABLE saved_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          engine TEXT NOT NULL CHECK (engine IN ('MySQL', 'PostgreSQL', 'SQLite')),
          host TEXT NOT NULL,
          port INTEGER NOT NULL,
          username TEXT NOT NULL,
          database_name TEXT NOT NULL DEFAULT '',
          password_cipher BLOB,
          save_password INTEGER NOT NULL DEFAULT 0,
          is_open INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO saved_connections
          (id, name, engine, host, port, username, database_name, password_cipher, save_password, is_open, created_at, updated_at)
        SELECT id, name, engine, host, port, username, database_name, password_cipher, save_password, is_open, created_at, updated_at
        FROM saved_connections_legacy;
        DROP TABLE saved_connections_legacy;
        CREATE UNIQUE INDEX saved_connections_unique_name ON saved_connections(name);
      `)
    }
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

  list(): StoredConnection[] {
    const rows = this.database
      .prepare(`
        SELECT id, name, engine, host, port, username, database_name, password_cipher, save_password, is_open
        FROM saved_connections
        ORDER BY id ASC
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
      password: this.decryptPassword(row.password_cipher),
      savePassword: Boolean(row.save_password),
      open: Boolean(row.is_open)
    }))
  }

  getById(id: number): StoredConnection | null {
    const row = this.database
      .prepare(`
        SELECT id, name, engine, host, port, username, database_name, password_cipher, save_password, is_open
        FROM saved_connections
        WHERE id = ?
      `)
      .get(id) as unknown as ConnectionRow | undefined

    if (!row) return null
    return {
      id: Number(row.id),
      name: row.name,
      engine: row.engine,
      host: row.host,
      port: Number(row.port),
      username: row.username,
      defaultDatabase: row.database_name,
      password: this.decryptPassword(row.password_cipher),
      savePassword: Boolean(row.save_password),
      open: Boolean(row.is_open)
    }
  }

  create(input: CreateConnectionInput): number {
    const passwordCipher = input.savePassword && input.password
      ? this.encryptPassword(input.password)
      : null

    const result = this.database
      .prepare(`
        INSERT INTO saved_connections (
          name, engine, host, port, username, database_name, password_cipher, save_password
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.name.trim(),
        input.engine,
        input.host.trim(),
        input.port,
        input.username.trim(),
        input.defaultDatabase.trim(),
        passwordCipher,
        input.savePassword ? 1 : 0
      )

    return Number(result.lastInsertRowid)
  }

  update(input: UpdateConnectionInput): void {
    if (!input.savePassword) {
      this.database.prepare(`
        UPDATE saved_connections
        SET name = ?, engine = ?, host = ?, port = ?, username = ?, database_name = ?,
            password_cipher = NULL, save_password = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(input.name.trim(), input.engine, input.host.trim(), input.port, input.username.trim(), input.defaultDatabase.trim(), input.id)
      return
    }

    if (input.password) {
      this.database.prepare(`
        UPDATE saved_connections
        SET name = ?, engine = ?, host = ?, port = ?, username = ?, database_name = ?,
            password_cipher = ?, save_password = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        input.name.trim(), input.engine, input.host.trim(), input.port, input.username.trim(), input.defaultDatabase.trim(),
        this.encryptPassword(input.password), input.id
      )
      return
    }

    this.database.prepare(`
      UPDATE saved_connections
      SET name = ?, engine = ?, host = ?, port = ?, username = ?, database_name = ?,
          save_password = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(input.name.trim(), input.engine, input.host.trim(), input.port, input.username.trim(), input.defaultDatabase.trim(), input.id)
  }

  setOpen(id: number, open: boolean): void {
    this.database.prepare(`
      UPDATE saved_connections SET is_open = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(open ? 1 : 0, id)
  }

  delete(id: number): void {
    this.database.prepare('DELETE FROM saved_connections WHERE id = ?').run(id)
  }

  duplicate(id: number): void {
    const source = this.database.prepare(`
      SELECT name, engine, host, port, username, database_name, password_cipher, save_password
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

    this.database.prepare(`
      INSERT INTO saved_connections (
        name, engine, host, port, username, database_name, password_cipher, save_password, is_open
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      copyName, source.engine, source.host, source.port, source.username, source.database_name,
      source.password_cipher, source.save_password
    )
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
      apiKey: this.decryptPassword(row.api_key_cipher),
      hasApiKey: Boolean(row.api_key_cipher),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  getAiModel(id: number): StoredAiModel | null {
    return this.listAiModels().find((model) => model.id === id) ?? null
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

  private decryptPassword(cipher: Uint8Array | null): string {
    if (!cipher || !safeStorage.isEncryptionAvailable()) return ''
    try {
      return safeStorage.decryptString(Buffer.from(cipher))
    } catch {
      return ''
    }
  }
}
