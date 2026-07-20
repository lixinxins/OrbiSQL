import { safeStorage } from 'electron'
import { DatabaseSync } from 'node:sqlite'
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
    `)
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
