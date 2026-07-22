import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Broom,
  CaretDown,
  CaretRight,
  CaretUp,
  Code,
  Copy,
  Database,
  DownloadSimple,
  FileCode,
  FolderOpen,
  Info,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Rows,
  Trash,
  UploadSimple,
  Wrench
} from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, TableItem } from '../../../shared/connections'

interface DatabaseTablesWorkspaceProps {
  active: boolean
  connection: DatabaseConnection
  database: DatabaseItem
  onOpenTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onDesignTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onCreateTable: (connection: DatabaseConnection, database: DatabaseItem) => void
  onRenameTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onDeleteTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onTruncateTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onCopyTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem, includeData: boolean) => void
  onSelectImportTable: (connection: DatabaseConnection, database: DatabaseItem) => void
  onSelectExportTable: (connection: DatabaseConnection, database: DatabaseItem) => void
  onGenerateSql?: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem, sqlKind: 'select' | 'insert' | 'update' | 'delete' | 'ddl') => void
  onMaintainTable?: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem, action: 'check' | 'optimize' | 'analyze') => void
  onShowTableInfo?: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
  onCopySqlStatement?: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem, type: 'select' | 'insert') => void
  onExportDataDictionary?: (connection: DatabaseConnection, database: DatabaseItem) => void
}

type SortField = 'name' | 'columns' | 'indexes' | 'rows' | 'size' | 'comment'
type SortOrder = 'asc' | 'desc'

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function DatabaseTablesWorkspace({
  active,
  connection,
  database,
  onOpenTable,
  onDesignTable,
  onCreateTable,
  onRenameTable,
  onDeleteTable,
  onTruncateTable,
  onCopyTable,
  onSelectImportTable,
  onSelectExportTable,
  onGenerateSql,
  onMaintainTable,
  onShowTableInfo,
  onCopySqlStatement,
  onExportDataDictionary
}: DatabaseTablesWorkspaceProps) {
  const [search, setSearch] = useState('')
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [tableStats, setTableStats] = useState<Record<string, { rows?: number; dataSize?: number }>>({})
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; table: TableItem } | null>(null)

  useEffect(() => {
    let isMounted = true
    const fetchStats = async (): Promise<void> => {
      if (connection.engine === 'MySQL' || connection.engine === 'MariaDB') {
        try {
          const res = await window.omnidb.queries.execute(
            connection.id,
            database.name,
            `SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${database.name}'`
          )
          if (isMounted && res.success && res.rows) {
            const map: Record<string, { rows?: number; dataSize?: number }> = {}
            for (const r of res.rows as Array<Record<string, unknown>>) {
              const name = String(r.TABLE_NAME ?? r.table_name ?? '')
              if (name) {
                map[name] = {
                  rows: Number(r.TABLE_ROWS ?? r.table_rows ?? 0),
                  dataSize: Number(r.DATA_LENGTH ?? r.data_length ?? 0)
                }
              }
            }
            setTableStats(map)
          }
        } catch {
          // ignore
        }
      }
    }
    void fetchStats()
    return () => { isMounted = false }
  }, [connection.id, connection.engine, database.name])

  useEffect(() => {
    if (!contextMenu) return
    const closeMenu = (): void => setContextMenu(null)
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [contextMenu])

  const toggleSort = (field: SortField): void => {
    if (sortField === field) {
      setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  const sortedTables = useMemo(() => {
    let list = database.tables
    const keyword = search.trim().toLowerCase()
    if (keyword) {
      list = list.filter((table) =>
        `${table.name} ${table.comment ?? ''}`.toLowerCase().includes(keyword)
      )
    }

    return [...list].sort((a, b) => {
      let valA: string | number = ''
      let valB: string | number = ''

      if (sortField === 'name') {
        valA = a.name.toLowerCase()
        valB = b.name.toLowerCase()
      } else if (sortField === 'columns') {
        valA = a.columns?.length ?? 0
        valB = b.columns?.length ?? 0
      } else if (sortField === 'indexes') {
        valA = a.indexes?.length ?? 0
        valB = b.indexes?.length ?? 0
      } else if (sortField === 'rows') {
        valA = tableStats[a.name]?.rows ?? 0
        valB = tableStats[b.name]?.rows ?? 0
      } else if (sortField === 'size') {
        valA = tableStats[a.name]?.dataSize ?? 0
        valB = tableStats[b.name]?.dataSize ?? 0
      } else if (sortField === 'comment') {
        valA = (a.comment ?? '').toLowerCase()
        valB = (b.comment ?? '').toLowerCase()
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1
      return 0
    })
  }, [database.tables, search, sortField, sortOrder, tableStats])

  const toggleSelectAll = (): void => {
    if (selectedTables.length === sortedTables.length) {
      setSelectedTables([])
    } else {
      setSelectedTables(sortedTables.map((t) => t.name))
    }
  }

  const toggleSelectTable = (name: string): void => {
    setSelectedTables((current) =>
      current.includes(name) ? current.filter((n) => n !== name) : [...current, name]
    )
  }

  const handleBatchTruncate = (): void => {
    if (!selectedTables.length) return
    if (window.confirm(`确定要批量清空选中的 ${selectedTables.length} 张数据表吗？`)) {
      selectedTables.forEach((name) => {
        const table = database.tables.find((t) => t.name === name)
        if (table) onTruncateTable(connection, database, table)
      })
      setSelectedTables([])
    }
  }

  const handleBatchDelete = (): void => {
    if (!selectedTables.length) return
    if (window.confirm(`确定要批量删除选中的 ${selectedTables.length} 张数据表吗？此操作无法撤销！`)) {
      selectedTables.forEach((name) => {
        const table = database.tables.find((t) => t.name === name)
        if (table) onDeleteTable(connection, database, table)
      })
      setSelectedTables([])
    }
  }

  const renderSortCaret = (field: SortField) => {
    if (sortField !== field) return null
    return sortOrder === 'asc' ? <CaretUp size={11} /> : <CaretDown size={11} />
  }

  return (
    <section className={`database-tables-workspace${active ? ' active' : ''}`}>
      <header className="database-tables-header">
        <div className="database-tables-title">
          <span><Database weight="duotone" /></span>
          <div>
            <h2>
              {database.name}
              {connection.color === '#ef4444' && <span className="connection-env-badge prod">PROD</span>}
              {connection.color === '#f59e0b' && <span className="connection-env-badge test">TEST</span>}
              {connection.color === '#10b981' && <span className="connection-env-badge dev">DEV</span>}
            </h2>
            <p>{connection.name} · {connection.engine} · 共 {database.tables.length} 张表</p>
          </div>
        </div>

        <div className="database-tables-actions">
          <button type="button" className="action-btn primary" onClick={() => onCreateTable(connection, database)}>
            <Plus />新建表
          </button>
          <button type="button" className="action-btn" onClick={() => onSelectImportTable(connection, database)}>
            <UploadSimple />导入 CSV
          </button>
          <button type="button" className="action-btn" onClick={() => onSelectExportTable(connection, database)}>
            <DownloadSimple />导出 CSV
          </button>
          <button type="button" className="action-btn" onClick={() => onExportDataDictionary?.(connection, database)}>
            <FileCode />数据字典
          </button>

          {selectedTables.length > 0 && (
            <>
              <span className="action-divider" />
              <button type="button" className="action-btn danger" onClick={handleBatchTruncate}>
                <Broom />清空选中的 {selectedTables.length} 张表
              </button>
              <button type="button" className="action-btn danger" onClick={handleBatchDelete}>
                <Trash />删除选中的 {selectedTables.length} 张表
              </button>
            </>
          )}
        </div>

        <label className="database-tables-search">
          <MagnifyingGlass />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索数据表名称或注释..."
            aria-label="筛选数据库表"
          />
        </label>
      </header>

      <div className="database-tables-content">
        <table className="db-tables-table">
          <thead>
            <tr>
              <th style={{ width: 36, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={sortedTables.length > 0 && selectedTables.length === sortedTables.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th onClick={() => toggleSort('name')} className="sortable-th">
                表名称 {renderSortCaret('name')}
              </th>
              <th onClick={() => toggleSort('comment')} className="sortable-th">
                表注释 {renderSortCaret('comment')}
              </th>
              <th onClick={() => toggleSort('columns')} className="sortable-th" style={{ width: 85, textAlign: 'right' }}>
                字段数 {renderSortCaret('columns')}
              </th>
              <th onClick={() => toggleSort('indexes')} className="sortable-th" style={{ width: 85, textAlign: 'right' }}>
                索引数 {renderSortCaret('indexes')}
              </th>
              <th onClick={() => toggleSort('rows')} className="sortable-th" style={{ width: 100, textAlign: 'right' }}>
                行数统计 {renderSortCaret('rows')}
              </th>
              <th onClick={() => toggleSort('size')} className="sortable-th" style={{ width: 110, textAlign: 'right' }}>
                占用空间 {renderSortCaret('size')}
              </th>
              <th style={{ width: 130, textAlign: 'center' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedTables.map((table) => {
              const isSelected = selectedTables.includes(table.name)
              const stats = tableStats[table.name]
              return (
                <tr
                  key={table.name}
                  className={isSelected ? 'selected' : ''}
                  onDoubleClick={() => onOpenTable(connection, database, table)}
                  onContextMenu={(e: ReactMouseEvent) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setContextMenu({
                      x: Math.min(e.clientX, window.innerWidth - 200),
                      y: Math.min(e.clientY, window.innerHeight - 380),
                      table
                    })
                  }}
                >
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectTable(table.name)}
                    />
                  </td>
                  <td className="table-name-cell" onClick={() => onOpenTable(connection, database, table)}>
                    <Rows className="table-icon" />
                    <span className="table-name-text">{table.name}</span>
                  </td>
                  <td className="table-comment-cell">
                    {table.comment ? (
                      <span className="comment-text">{table.comment}</span>
                    ) : (
                      <span className="comment-empty">暂无注释</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="count-badge">{table.columns?.length ?? 0}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="count-badge muted">{table.indexes?.length ?? 0}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {stats?.rows !== undefined ? stats.rows.toLocaleString('zh-CN') : '-'}
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                    {stats?.dataSize !== undefined ? formatBytes(stats.dataSize) : '-'}
                  </td>
                  <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <div className="table-row-actions">
                      <button type="button" title="打开数据" onClick={() => onOpenTable(connection, database, table)}>
                        <FolderOpen />
                      </button>
                      <button type="button" title="设计字段" onClick={() => onDesignTable(connection, database, table)}>
                        <PencilSimple />
                      </button>
                      <button type="button" title="查看属性" onClick={() => onShowTableInfo?.(connection, database, table)}>
                        <Info />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {!sortedTables.length && (
          <div className="database-tables-empty">
            <Rows />
            <strong>{search.trim() ? '没有匹配的数据表' : '该数据库暂无数据表'}</strong>
            <span>{search.trim() ? '请尝试其他关键词' : '可以点击上方“新建表”进行创建'}</span>
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="connection-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => { onOpenTable(connection, database, contextMenu.table); setContextMenu(null) }}>
            <FolderOpen />打开表数据
          </button>
          <button type="button" onClick={() => { onDesignTable(connection, database, contextMenu.table); setContextMenu(null) }}>
            <PencilSimple />设计表
          </button>
          <button type="button" onClick={() => { onRenameTable(connection, database, contextMenu.table); setContextMenu(null) }}>
            <PencilSimple />编辑表名称
          </button>
          <div className="context-submenu-host">
            <button type="button"><Copy /><span className="context-menu-label">复制表</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${contextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onCopyTable(connection, database, contextMenu.table, false); setContextMenu(null) }}>
                <Copy />仅复制结构
              </button>
              <button type="button" onClick={() => { onCopyTable(connection, database, contextMenu.table, true); setContextMenu(null) }}>
                <Copy weight="fill" />复制结构和数据
              </button>
            </div>
          </div>
          <button type="button" onClick={() => { onShowTableInfo?.(connection, database, contextMenu.table); setContextMenu(null) }}>
            <Info />查看表属性与信息
          </button>
          <span className="context-menu-divider" />
          <div className="context-submenu-host">
            <button type="button"><FileCode /><span className="context-menu-label">生成 SQL</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${contextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onGenerateSql?.(connection, database, contextMenu.table, 'select'); setContextMenu(null) }}>
                <Code />生成 SELECT 语句
              </button>
              <button type="button" onClick={() => { onGenerateSql?.(connection, database, contextMenu.table, 'insert'); setContextMenu(null) }}>
                <Code />生成 INSERT 模板
              </button>
              <button type="button" onClick={() => { onGenerateSql?.(connection, database, contextMenu.table, 'update'); setContextMenu(null) }}>
                <Code />生成 UPDATE 模板
              </button>
              <button type="button" onClick={() => { onGenerateSql?.(connection, database, contextMenu.table, 'delete'); setContextMenu(null) }}>
                <Code />生成 DELETE 模板
              </button>
              <button type="button" onClick={() => { onGenerateSql?.(connection, database, contextMenu.table, 'ddl'); setContextMenu(null) }}>
                <FileCode />查看建表 DDL
              </button>
            </div>
          </div>
          <div className="context-submenu-host">
            <button type="button"><Wrench /><span className="context-menu-label">表维护工具</span><CaretRight className="context-submenu-caret" /></button>
            <div className={`connection-context-menu context-submenu${contextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => { onMaintainTable?.(connection, database, contextMenu.table, 'check'); setContextMenu(null) }}>
                <Wrench />检查表 (CHECK TABLE)
              </button>
              <button type="button" onClick={() => { onMaintainTable?.(connection, database, contextMenu.table, 'optimize'); setContextMenu(null) }}>
                <Wrench />优化表 (OPTIMIZE TABLE)
              </button>
              <button type="button" onClick={() => { onMaintainTable?.(connection, database, contextMenu.table, 'analyze'); setContextMenu(null) }}>
                <Wrench />分析表 (ANALYZE TABLE)
              </button>
            </div>
          </div>
          <button type="button" onClick={() => { void navigator.clipboard.writeText(contextMenu.table.name); setContextMenu(null) }}>
            <Copy />复制表名称
          </button>
          <button type="button" onClick={() => { void onCopySqlStatement?.(connection, database, contextMenu.table, 'select'); setContextMenu(null) }}>
            <Copy />复制 SELECT 语句
          </button>
          <button type="button" onClick={() => { void onCopySqlStatement?.(connection, database, contextMenu.table, 'insert'); setContextMenu(null) }}>
            <Copy />复制 INSERT 语句
          </button>
          <span className="context-menu-divider" />
          <button type="button" className="danger" onClick={() => { onTruncateTable(connection, database, contextMenu.table); setContextMenu(null) }}>
            <Broom />清空表数据
          </button>
          <button type="button" className="danger" onClick={() => { onDeleteTable(connection, database, contextMenu.table); setContextMenu(null) }}>
            <Trash />删除表
          </button>
        </div>
      )}
    </section>
  )
}

export default DatabaseTablesWorkspace
