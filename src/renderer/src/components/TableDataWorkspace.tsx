import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowLineLeft, ArrowLineRight, ArrowRight, ArrowsClockwise, CaretRight, Check, Copy, DownloadSimple, Funnel, GearSix, ListBullets, Minus, PencilSimple, Plus, Stop, Table as TableIcon, Trash, X } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, QueryExecutionResult, TableDataFilter, TableDataFilterOperator, TableItem } from '../../../shared/connections'
import { useConfirmDialog } from './ConfirmDialog'

interface TableDataWorkspaceProps {
  active: boolean
  connection: DatabaseConnection
  database: DatabaseItem
  table: TableItem
  onDesignTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
}

function TableDataWorkspace({ active, connection, database, table, onDesignTable }: TableDataWorkspaceProps) {
  const { confirm, confirmDialog } = useConfirmDialog()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [result, setResult] = useState<QueryExecutionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null)
  const [draftValue, setDraftValue] = useState<unknown>('')
  const [savingCell, setSavingCell] = useState(false)
  const [rowSaveError, setRowSaveError] = useState('')
  const [filterColumn, setFilterColumn] = useState(table.columns[0] ?? '')
  const [filterOperator, setFilterOperator] = useState<TableDataFilterOperator>('contains')
  const [filterValue, setFilterValue] = useState('')
  const [appliedFilter, setAppliedFilter] = useState<TableDataFilter | undefined>()
  const [resultContextMenu, setResultContextMenu] = useState<{ x: number; y: number; rowIndex: number; column: string } | null>(null)
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [newRowDraft, setNewRowDraft] = useState<Record<string, unknown> | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'record'>('grid')
  const [showPageSize, setShowPageSize] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState<number>(0)
  const [detailModal, setDetailModal] = useState<{ rowIndex: number; column: string; text: string } | null>(null)
  const loadRequestId = useRef(0)

  useEffect(() => {
    if (!resultContextMenu) return
    const close = (): void => setResultContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', close)
    }
  }, [resultContextMenu])

  const loadData = useCallback(async (): Promise<void> => {
    const requestId = ++loadRequestId.current
    setLoading(true)
    setEditingCell(null)
    setSelectedRowIndex(null)
    setNewRowDraft(null)
    setRowSaveError('')
    try {
      const res = await window.omnidb.tables.readData(
        connection.id,
        database.name,
        table.name,
        pageSize,
        page * pageSize,
        appliedFilter
      )
      if (requestId === loadRequestId.current) {
        setResult(res)
        setLoading(false)
      }
    } catch (error) {
      if (requestId === loadRequestId.current) {
        setResult({ success: false, message: error instanceof Error ? error.message : '加载数据失败' })
        setLoading(false)
      }
    }
  }, [connection.id, database.name, table.name, page, pageSize, appliedFilter])

  useEffect(() => {
    if (autoRefresh <= 0 || !active) return
    const timer = setInterval(() => {
      void loadData()
    }, autoRefresh * 1000)
    return () => clearInterval(timer)
  }, [active, autoRefresh, loadData])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const displayValue = (value: unknown): ReactNode => {
    if (value === null) return <span className="cell-null">NULL</span>
    if (value instanceof Uint8Array) return <span className="cell-badge binary">[BLOB {value.byteLength} B]</span>
    if (Array.isArray(value)) {
      const jsonStr = JSON.stringify(value)
      return (
        <span className="cell-pg-tag array" title={jsonStr}>
          <span className="pg-badge">ARRAY</span>
          {`[${value.map((v) => (typeof v === 'string' ? `'${v}'` : String(v))).join(', ')}]`}
        </span>
      )
    }
    if (typeof value === 'object') {
      const jsonStr = JSON.stringify(value)
      return (
        <span className="cell-pg-tag json" title={jsonStr}>
          <span className="pg-badge">JSONB</span>
          {jsonStr.length > 35 ? `${jsonStr.slice(0, 35)}…` : jsonStr}
        </span>
      )
    }

    const str = String(value)
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str)) {
      return (
        <span className="cell-pg-tag uuid" title={str}>
          <span className="pg-badge">UUID</span>
          <code style={{ fontFamily: 'monospace', fontSize: 11 }}>{str}</code>
        </span>
      )
    }

    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d{1,2})?$/.test(str)) {
      return (
        <span className="cell-pg-tag inet" title={str}>
          <span className="pg-badge">INET</span>
          {str}
        </span>
      )
    }

    if (/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/.test(str)) {
      return (
        <span className="cell-pg-tag mac" title={str}>
          <span className="pg-badge">MAC</span>
          {str}
        </span>
      )
    }

    return str
  }

  const startEditingCell = (rowIndex: number, column: string): void => {
    if (!result?.rows?.[rowIndex] || !result.editable?.columns.some((item) => item.resultName === column)) return
    setEditingCell({ rowIndex, column })
    setDraftValue(result.rows[rowIndex][column])
    setRowSaveError('')
  }

  const saveEditingCell = async (): Promise<void> => {
    if (!editingCell || !result?.rows?.[editingCell.rowIndex] || !result.editable) return
    const originalRow = result.rows[editingCell.rowIndex]
    const column = result.editable.columns.find((item) => item.resultName === editingCell.column)
    if (!column) return
    if (draftValue === originalRow[editingCell.column]) {
      setEditingCell(null)
      return
    }
    const primaryKeyValues: Record<string, unknown> = {}
    result.editable.columns.forEach((column) => {
      if (column.primaryKey) primaryKeyValues[column.sourceName] = originalRow[column.resultName]
    })

    setSavingCell(true)
    try {
      const saved = await window.omnidb.tables.updateRow({
        connectionId: connection.id,
        databaseName: database.name,
        tableName: table.name,
        primaryKeyValues,
        changes: { [column.sourceName]: draftValue }
      })
      if (!saved.success) {
        setRowSaveError(saved.message)
        return
      }
      setResult((current) => current?.rows ? {
        ...current,
        success: true,
        message: saved.message,
        rows: current.rows.map((row, index) => index === editingCell.rowIndex
          ? { ...row, [editingCell.column]: draftValue }
          : row)
      } : current)
      setRowSaveError('')
      setEditingCell(null)
    } finally {
      setSavingCell(false)
    }
  }

  const deleteRow = async (rowIndex: number): Promise<void> => {
    if (!result?.rows?.[rowIndex] || !result.editable) return
    setResultContextMenu(null)
    const confirmed = await confirm({
      title: '删除数据记录',
      message: `确定要删除表“${table.name}”中的这条记录吗？`,
      detail: '该记录会从数据库中永久删除，此操作无法撤销。',
      confirmLabel: '删除记录'
    })
    if (!confirmed) return
    const row = result.rows[rowIndex]
    const primaryKeyValues: Record<string, unknown> = {}
    result.editable.columns.forEach((column) => {
      if (column.primaryKey) primaryKeyValues[column.sourceName] = row[column.resultName]
    })
    setRowSaveError('')
    const deleted = await window.omnidb.tables.deleteRow({
      connectionId: connection.id,
      databaseName: database.name,
      tableName: table.name,
      primaryKeyValues
    })
    if (!deleted.success) {
      setRowSaveError(deleted.message)
      return
    }
    setResult((current) => current?.rows ? {
      ...current,
      success: true,
      message: deleted.message,
      rows: current.rows.filter((_, index) => index !== rowIndex)
    } : current)
    setEditingCell(null)
  }

  const sqlIdentifier = (value: string): string => ['MySQL', 'MariaDB', 'TiDB'].includes(connection.engine)
    ? `\`${value.replaceAll('`', '``')}\``
    : `"${value.replaceAll('"', '""')}"`

  const sqlValue = (value: unknown): string => {
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number' || typeof value === 'bigint') return String(value)
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (value instanceof Uint8Array) return `X'${Array.from(value).map((byte) => byte.toString(16).padStart(2, '0')).join('')}'`
    return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
  }

  const copyText = async (text: string, successMessage: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setRowSaveError('')
      setResult((current) => current ? { ...current, message: successMessage } : current)
    } catch {
      setRowSaveError('复制失败，请检查剪贴板权限')
    } finally {
      setResultContextMenu(null)
    }
  }

  const buildInsertSql = (rowIndex: number): string => {
    if (!result?.editable || !result.rows?.[rowIndex]) return ''
    const row = result.rows[rowIndex]
    const columns = result.editable.columns
    return `INSERT INTO ${sqlIdentifier(database.name)}.${sqlIdentifier(table.name)} (${columns.map((column) => sqlIdentifier(column.sourceName)).join(', ')}) VALUES (${columns.map((column) => sqlValue(row[column.resultName])).join(', ')});`
  }

  const buildUpdateSql = (rowIndex: number): string => {
    if (!result?.editable || !result.rows?.[rowIndex]) return ''
    const row = result.rows[rowIndex]
    const changedColumns = result.editable.columns.filter((column) => !column.primaryKey)
    const primaryKeys = result.editable.columns.filter((column) => column.primaryKey)
    return `UPDATE ${sqlIdentifier(database.name)}.${sqlIdentifier(table.name)} SET ${changedColumns.map((column) => `${sqlIdentifier(column.sourceName)} = ${sqlValue(row[column.resultName])}`).join(', ')} WHERE ${primaryKeys.map((column) => `${sqlIdentifier(column.sourceName)} <=> ${sqlValue(row[column.resultName])}`).join(' AND ')};`
  }

  const rows = result?.rows ?? []
  const availableColumns = table.columns.length ? table.columns : result?.columns ?? []
  const filterNeedsValue = !['isEmpty', 'isEmptyOrNull', 'isNotEmpty', 'isNull', 'isNotNull'].includes(filterOperator)

  const applyFilter = (): void => {
    if (!filterColumn || filterNeedsValue && !filterValue.trim()) return
    setPage(0)
    setAppliedFilter({ column: filterColumn, operator: filterOperator, value: filterValue })
  }

  const resetFilter = (): void => {
    setPage(0)
    setAppliedFilter(undefined)
    setFilterValue('')
  }

  const selectSql = `SELECT * FROM ${sqlIdentifier(table.name)}${appliedFilter ? ' WHERE …' : ''} LIMIT ${pageSize} OFFSET ${page * pageSize}`

  const addRow = (): void => {
    if (!result?.columns?.length || loading) return
    setNewRowDraft(Object.fromEntries(result.columns.map((column) => [column, undefined])))
    setEditingCell(null)
    setSelectedRowIndex(null)
    setRowSaveError('')
    setViewMode('grid')
  }

  const saveNewRow = async (): Promise<void> => {
    if (!newRowDraft || !result?.columns?.length) return
    const entries = result.columns.filter((column) => newRowDraft[column] !== undefined).map((column) => [column, newRowDraft[column]] as const)
    const target = sqlIdentifier(table.name)
    const insertSql = entries.length
      ? `INSERT INTO ${target} (${entries.map(([column]) => sqlIdentifier(column)).join(', ')}) VALUES (${entries.map(([, value]) => sqlValue(value)).join(', ')})`
      : ['MySQL', 'MariaDB', 'TiDB'].includes(connection.engine)
        ? `INSERT INTO ${target} () VALUES ()`
        : `INSERT INTO ${target} DEFAULT VALUES`
    setSavingCell(true)
    try {
      const inserted = await window.omnidb.queries.execute(connection.id, database.name, insertSql)
      if (!inserted.success) {
        setRowSaveError(inserted.message)
        return
      }
      setNewRowDraft(null)
      await loadData()
    } finally {
      setSavingCell(false)
    }
  }

  const savePendingChange = (): void => {
    if (newRowDraft) void saveNewRow()
    else if (editingCell) void saveEditingCell()
  }

  const cancelPendingChange = (): void => {
    setNewRowDraft(null)
    setEditingCell(null)
    setRowSaveError('')
  }

  const stopLoading = (): void => {
    if (!loading) return
    loadRequestId.current += 1
    setLoading(false)
  }

  const goToLastPage = async (): Promise<void> => {
    if (loading) return
    if (appliedFilter) {
      setRowSaveError('筛选状态下无法直接定位末页')
      return
    }
    const counted = await window.omnidb.queries.execute(
      connection.id,
      database.name,
      `SELECT COUNT(*) AS total FROM ${sqlIdentifier(table.name)}`
    )
    if (!counted.success || !counted.rows?.length) {
      setRowSaveError(counted.message || '无法获取数据总数')
      return
    }
    const total = Number(counted.rows[0].total ?? Object.values(counted.rows[0])[0] ?? 0)
    setPage(Math.max(0, Math.ceil(total / pageSize) - 1))
  }

  const duplicateRow = (rowIndex: number): void => {
    if (!result?.rows?.[rowIndex] || !result.columns) return
    const sourceRow = result.rows[rowIndex]
    const draft: Record<string, unknown> = {}
    for (const col of result.columns) {
      const isPk = result.editable?.columns.find((c) => c.resultName === col)?.primaryKey
      if (!isPk) draft[col] = sourceRow[col]
    }
    setNewRowDraft(draft)
    setEditingCell(null)
    setSelectedRowIndex(null)
    setRowSaveError('')
  }

  const getCellValueString = (rowIndex: number, column: string): string => {
    if (!result?.rows?.[rowIndex]) return ''
    const val = result.rows[rowIndex][column]
    if (val === null) return 'NULL'
    if (val === undefined) return ''
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  const exportGridData = (format: 'csv' | 'json'): void => {
    if (!result?.rows || !result.columns) return
    let content = ''
    if (format === 'csv') {
      content = [
        result.columns.join(','),
        ...result.rows.map((row) => result.columns!.map((c) => JSON.stringify(row[c] ?? '')).join(','))
      ].join('\n')
    } else {
      content = JSON.stringify(result.rows, null, 2)
    }

    const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${table.name}_data.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className={`table-data-workspace${active ? ' active' : ''}`}>
      <div className="table-data-toolbar">
        <div className="table-data-location">
          <strong>{table.name}</strong><span>{connection.name} / {database.name}</span>
        </div>
        <button type="button" onClick={() => onDesignTable(connection, database, table)}><PencilSimple />设计字段</button>
        <button type="button" disabled={!result?.rows?.length} onClick={() => exportGridData('csv')}><DownloadSimple />导出 CSV</button>
        <button type="button" disabled={!result?.rows?.length} onClick={() => exportGridData('json')}><DownloadSimple />导出 JSON</button>
        <span className="table-data-toolbar-spacer" />
      </div>
      <div className="table-data-filter">
        <Funnel />
        <span>筛选</span>
        <select value={filterColumn} onChange={(event) => setFilterColumn(event.target.value)} aria-label="筛选字段">
          {!availableColumns.length && <option value="">暂无字段</option>}
          {availableColumns.map((column) => <option value={column} key={column}>{column}</option>)}
        </select>
        <select value={filterOperator} onChange={(event) => setFilterOperator(event.target.value as TableDataFilterOperator)} aria-label="筛选条件">
          <option value="contains">包含</option>
          <option value="startsWith">开头是</option>
          <option value="equals">等于</option>
          <option value="notEquals">不等于</option>
          <option value="greaterThan">大于</option>
          <option value="greaterThanOrEqual">大于等于</option>
          <option value="lessThan">小于</option>
          <option value="lessThanOrEqual">小于等于</option>
          <option value="isEmpty">为空字符串</option>
          <option value="isNull">为 NULL</option>
          <option value="isEmptyOrNull">为空或 NULL</option>
          <option value="isNotEmpty">非空且非 NULL</option>
          <option value="isNotNull">不为 NULL</option>
        </select>
        <input
          value={filterValue}
          disabled={!filterNeedsValue}
          onChange={(event) => setFilterValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') applyFilter() }}
          placeholder={filterNeedsValue ? '输入筛选值' : '不需要输入值'}
        />
        <button type="button" className="apply-filter" disabled={!filterColumn || filterNeedsValue && !filterValue.trim()} onClick={applyFilter}>应用</button>
        <button type="button" className="reset-filter" disabled={!appliedFilter} onClick={resetFilter}><X />重置</button>
        {appliedFilter && <span className="active-filter-label">已应用：{appliedFilter.column}</span>}
      </div>
      {(rowSaveError || result && !result.success) && <div className="query-message error">
        <span>{rowSaveError || result?.message}</span>
      </div>}
      <div className="table-data-grid-wrap">
        {viewMode === 'grid' && result?.success && result.columns && (
          <table className="query-table table-data-grid">
            <thead>
              <tr>
                {result.columns.map((column) => {
                  const isPk = result.editable?.columns.find((item) => item.resultName === column)?.primaryKey
                  return (
                    <th key={column}>
                      {isPk && <span title="主键 Primary Key" style={{ cursor: 'help' }}>🔑 </span>}
                      {column}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
            {newRowDraft && <tr className="new-data-row">
              {result.columns.map((column) => <td key={column} className="editing-cell">
                <input
                  value={newRowDraft[column] === undefined || newRowDraft[column] === null ? '' : String(newRowDraft[column])}
                  placeholder="默认值"
                  onChange={(event) => setNewRowDraft((current) => current ? { ...current, [column]: event.target.value } : current)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void saveNewRow()
                    if (event.key === 'Escape') cancelPendingChange()
                  }}
                />
              </td>)}
            </tr>}
            {rows.map((row, index) => <tr key={index} className={`${editingCell?.rowIndex === index ? 'editing ' : ''}${selectedRowIndex === index ? 'selected' : ''}`}>
              {result.columns!.map((column) => {
                const editableColumn = result.editable?.columns.find((item) => item.resultName === column)
                const isEditing = editingCell?.rowIndex === index && editingCell.column === column
                return <td
                  key={column}
                  className={`${editableColumn ? 'editable-cell' : ''}${isEditing ? ' editing-cell' : ''}`}
                  onClick={() => {
                    setSelectedRowIndex(index)
                    if (editableColumn && !isEditing) startEditingCell(index, column)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setResultContextMenu({ x: Math.min(event.clientX, window.innerWidth - 196), y: Math.min(event.clientY, window.innerHeight - 190), rowIndex: index, column })
                  }}
                >
                  {isEditing
                    ? <span className="cell-editor table-data-cell-editor" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        autoFocus
                        value={draftValue === null || draftValue === undefined ? '' : String(draftValue)}
                        onChange={(event) => setDraftValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveEditingCell()
                          if (event.key === 'Escape') setEditingCell(null)
                        }}
                      />
                      <button type="button" style={{ fontSize: 9, padding: '1px 4px', cursor: 'pointer' }} onClick={() => setDraftValue(null)}>NULL</button>
                      <button type="button" style={{ fontSize: 9, padding: '1px 4px', cursor: 'pointer' }} onClick={() => setDraftValue('')}>EMPTY</button>
                    </span>
                    : displayValue(row[column])}
                </td>
              })}
            </tr>)}
            </tbody>
          </table>
        )}
        {viewMode === 'record' && result?.success && result.columns && (
          <div className="table-record-view">
            {selectedRowIndex !== null && rows[selectedRowIndex]
              ? result.columns.map((column) => <dl key={column}><dt>{column}</dt><dd>{displayValue(rows[selectedRowIndex][column])}</dd></dl>)
              : <div className="table-data-empty">请先在表格视图中选择一条记录</div>}
          </div>
        )}
        {viewMode === 'grid' && result?.success && !rows.length && !newRowDraft && <div className="table-data-empty">当前数据表中没有数据</div>}
      </div>
      <div className="table-data-bottom-toolbar">
        <div className="table-data-bottom-actions">
          <button type="button" title="新增记录" disabled={!result?.success || !result.columns?.length || loading || Boolean(newRowDraft)} onClick={addRow}><Plus /></button>
          <button type="button" title="删除选中记录" disabled={selectedRowIndex === null || !result?.editable || loading} onClick={() => selectedRowIndex !== null && void deleteRow(selectedRowIndex)}><Minus /></button>
          <button type="button" title="保存修改" disabled={savingCell || !newRowDraft && !editingCell} onClick={savePendingChange}><Check /></button>
          <button type="button" title="取消修改" disabled={!newRowDraft && !editingCell} onClick={cancelPendingChange}><X /></button>
          <button type="button" title="刷新数据" disabled={loading} onClick={() => void loadData()}><ArrowsClockwise /></button>
          <button type="button" title="停止加载" disabled={!loading} onClick={stopLoading}><Stop weight="fill" /></button>
          <select value={autoRefresh} onChange={(e) => setAutoRefresh(Number(e.target.value))} style={{ height: 26, fontSize: 11, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', cursor: 'pointer' }} title="自动刷新数据">
            <option value={0}>手动刷新</option>
            <option value={5}>每 5 秒刷新</option>
            <option value={10}>每 10 秒刷新</option>
            <option value={30}>每 30 秒刷新</option>
          </select>
        </div>
        <code className="table-data-current-sql" title={selectSql}>{selectSql}</code>
        <div className="table-data-bottom-pagination">
          <button type="button" title="首页" disabled={loading || page === 0} onClick={() => setPage(0)}><ArrowLineLeft /></button>
          <button type="button" title="上一页" disabled={loading || page === 0} onClick={() => setPage((current) => current - 1)}><ArrowLeft /></button>
          <input value={page + 1} aria-label="当前页码" onChange={(event) => {
            const nextPage = Number.parseInt(event.target.value, 10)
            if (Number.isFinite(nextPage) && nextPage > 0) setPage(nextPage - 1)
          }} />
          <button type="button" title="下一页" disabled={loading || rows.length < pageSize} onClick={() => setPage((current) => current + 1)}><ArrowRight /></button>
          <button type="button" title="末页" disabled={loading} onClick={() => void goToLastPage()}><ArrowLineRight /></button>
          <div className="table-data-page-size-host">
            <button type="button" title="每页数量" onClick={() => setShowPageSize((current) => !current)}><GearSix /></button>
            {showPageSize && <div className="table-data-page-size-menu">
              {[30, 50, 100, 200, 500].map((size) => <button type="button" className={pageSize === size ? 'active' : ''} key={size} onClick={() => { setPage(0); setPageSize(size); setShowPageSize(false) }}>{size} 行/页</button>)}
            </div>}
          </div>
          <button type="button" className={viewMode === 'grid' ? 'active' : ''} title="表格视图" onClick={() => setViewMode('grid')}><TableIcon /></button>
          <button type="button" className={viewMode === 'record' ? 'active' : ''} title="记录视图" onClick={() => setViewMode('record')}><ListBullets /></button>
        </div>
      </div>
      {resultContextMenu && result?.rows?.[resultContextMenu.rowIndex] && (
        <div
          className="connection-context-menu query-result-context-menu"
          style={{ left: resultContextMenu.x, top: resultContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => void copyText(getCellValueString(resultContextMenu.rowIndex, resultContextMenu.column), '单元格值已复制')}>
            <Copy />复制单元格值
          </button>
          <button type="button" onClick={() => {
            setDetailModal({
              rowIndex: resultContextMenu.rowIndex,
              column: resultContextMenu.column,
              text: getCellValueString(resultContextMenu.rowIndex, resultContextMenu.column)
            })
            setResultContextMenu(null)
          }}>
            <PencilSimple />查看 / 编辑大文本与 JSON
          </button>
          <button type="button" onClick={() => duplicateRow(resultContextMenu.rowIndex)}>
            <Copy />克隆 / 复制此行记录
          </button>
          <button type="button" className="danger" disabled={!result.editable} onClick={() => void deleteRow(resultContextMenu.rowIndex)}>
            <Trash />删除记录
          </button>
          <span className="context-menu-divider" />
          <button type="button" disabled={!resultContextMenu.column} onClick={() => void copyText(resultContextMenu.column, '字段名称已复制')}>
            <Copy />复制字段名称
          </button>
          <div className="context-submenu-host">
            <button type="button" disabled={!result.editable}><Copy /><span className="context-menu-label">复制 SQL 为</span><CaretRight className="context-submenu-caret" /></button>
            {result.editable && <div className={`connection-context-menu context-submenu${resultContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => void copyText(buildInsertSql(resultContextMenu.rowIndex), '新增语句已复制')}><Copy />复制为 INSERT 语句</button>
              <button type="button" onClick={() => void copyText(buildUpdateSql(resultContextMenu.rowIndex), '修改语句已复制')}><Copy />复制为 UPDATE 语句</button>
            </div>}
          </div>
        </div>
      )}
      {detailModal && (
        <div className="connection-dialog-backdrop ai-model-dialog-backdrop" onClick={() => setDetailModal(null)}>
          <div className="table-info-dialog" onClick={(e) => e.stopPropagation()} style={{ width: 680 }}>
            <header className="table-info-tabs" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>查看 / 编辑大文本与 JSON — 字段 [{detailModal.column}]</h3>
              <button type="button" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--muted)' }} onClick={() => setDetailModal(null)}><X /></button>
            </header>
            <div className="table-info-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
              <textarea
                rows={14}
                style={{ width: '100%', fontFamily: 'monospace', padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text)', fontSize: 12.5, lineHeight: 1.5, resize: 'vertical' }}
                value={detailModal.text}
                onChange={(e) => setDetailModal({ ...detailModal, text: e.target.value })}
                placeholder="请输入长文本或 JSON 内容..."
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="action-btn" onClick={() => {
                  try {
                    const formatted = JSON.stringify(JSON.parse(detailModal.text), null, 2)
                    setDetailModal({ ...detailModal, text: formatted })
                  } catch {
                    window.alert('当前文本不是有效的 JSON 格式')
                  }
                }}>格式化 JSON</button>
                <button type="button" className="action-btn" onClick={() => setDetailModal({ ...detailModal, text: '' })}>置为空字符串</button>
                <button type="button" className="action-btn" onClick={() => void copyText(detailModal.text, '大文本已复制')}>复制文本</button>
                <button type="button" className="action-btn primary" onClick={() => {
                  startEditingCell(detailModal.rowIndex, detailModal.column)
                  setDraftValue(detailModal.text)
                  setDetailModal(null)
                }}>填入单元格并保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </section>
  )
}

export default TableDataWorkspace
