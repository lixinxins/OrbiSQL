import type { SaveQueryInput, SavedQuery } from '../../shared/connections'
import type { SqliteDatabase } from '../services/sqlite-runtime'

interface SavedQueryRow {
  id: number
  connection_id: number
  database_name: string
  name: string
  sql_text: string
  created_at: string
  updated_at: string
}

export class SavedQueriesRepository {
  constructor(private readonly database: SqliteDatabase) {}

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
}
