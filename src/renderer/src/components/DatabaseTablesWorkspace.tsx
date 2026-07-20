import { useMemo, useState } from 'react'
import { Database, MagnifyingGlass, Rows } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, TableItem } from '../../../shared/connections'

interface DatabaseTablesWorkspaceProps {
  active: boolean
  connection: DatabaseConnection
  database: DatabaseItem
  onOpenTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
}

function DatabaseTablesWorkspace({
  active,
  connection,
  database,
  onOpenTable
}: DatabaseTablesWorkspaceProps) {
  const [search, setSearch] = useState('')
  const visibleTables = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return database.tables
    return database.tables.filter((table) =>
      `${table.name} ${table.comment ?? ''}`.toLowerCase().includes(keyword)
    )
  }, [database.tables, search])

  return (
    <section className={`database-tables-workspace${active ? ' active' : ''}`}>
      <header className="database-tables-header">
        <div className="database-tables-title">
          <span><Database weight="duotone" /></span>
          <div>
            <h2>{database.name}</h2>
            <p>{connection.name} · {connection.engine} · 共 {database.tables.length} 张表</p>
          </div>
        </div>
        <label className="database-tables-search">
          <MagnifyingGlass />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="筛选表名称或注释"
            aria-label="筛选数据库表"
          />
        </label>
      </header>

      <div className="database-tables-content">
        <div className="database-tables-grid database-tables-grid-header">
          <span>表名称</span>
          <span>表注释</span>
        </div>
        <div className="database-tables-list">
          {visibleTables.map((table) => (
            <button
              type="button"
              className="database-tables-grid database-table-item"
              key={table.name}
              title="双击打开表数据"
              onDoubleClick={() => onOpenTable(connection, database, table)}
            >
              <span className="database-table-name"><Rows />{table.name}</span>
              <span className={`database-table-comment${table.comment ? '' : ' empty'}`}>
                {table.comment || '暂无注释'}
              </span>
            </button>
          ))}
          {!visibleTables.length && (
            <div className="database-tables-empty">
              <Rows />
              <strong>{search.trim() ? '没有匹配的数据表' : '该数据库暂无数据表'}</strong>
              <span>{search.trim() ? '请尝试其他关键词' : '创建表后会在这里显示'}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default DatabaseTablesWorkspace
