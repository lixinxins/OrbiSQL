import type { ConnectionGroup } from '../../shared/connections'
import type { SqliteDatabase } from '../services/sqlite-runtime'
import { getTableColumns } from './schema'

export class GroupsRepository {
  constructor(private readonly database: SqliteDatabase) {}

  listGroups(): ConnectionGroup[] {
    const columns = getTableColumns(this.database, 'connection_groups')
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
    const columns = getTableColumns(this.database, 'connection_groups')
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
}
