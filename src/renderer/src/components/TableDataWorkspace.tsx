import { useCallback, useEffect, useState } from 'react'
import { ArrowsClockwise, CaretLeft, CaretRight, Copy, FloppyDisk, Funnel, PencilSimple, Trash, X } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, QueryExecutionResult, TableDataFilter, TableDataFilterOperator, TableItem } from '../../../shared/connections'
import { useConfirmDialog } from './ConfirmDialog'

interface TableDataWorkspaceProps {
  active: boolean
  connection: DatabaseConnection
  database: DatabaseItem
  table: TableItem
  onDesignTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
}

const PAGE_SIZE = 100

function TableDataWorkspace({ active, connection, database, table, onDesignTable }: TableDataWorkspaceProps) {
  const { confirm, confirmDialog } = useConfirmDialog()
  const [page, setPage] = useState(0)
  const [result, setResult] = useState<QueryExecutionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null)
  const [draftValue, setDraftValue] = useState<unknown>('')
  const [savingCell, setSavingCell] = useState(false)
  const [deletingRow, setDeletingRow] = useState<number | null>(null)
  const [rowSaveError, setRowSaveError] = useState('')
  const [filterColumn, setFilterColumn] = useState(table.columns[0] ?? '')
  const [filterOperator, setFilterOperator] = useState<TableDataFilterOperator>('contains')
  const [filterValue, setFilterValue] = useState('')
  const [appliedFilter, setAppliedFilter] = useState<TableDataFilter | undefined>()
  const [resultContextMenu, setResultContextMenu] = useState<{ x: number; y: number; rowIndex: number; column: string } | null>(null)

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
    setLoading(true)
    setEditingCell(null)
    setRowSaveError('')
    try {
      setResult(await window.omnidb.tables.readData(
        connection.id,
        database.name,
        table.name,
        PAGE_SIZE,
        page * PAGE_SIZE,
        appliedFilter
      ))
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : '数据加载失败，请重启应用后重试'
      })
    } finally {
      setLoading(false)
    }
  }, [appliedFilter, connection.id, database.name, page, table.name])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const displayValue = (value: unknown): string => {
    if (value === null) return 'NULL'
    if (value instanceof Uint8Array) return `[二进制 ${value.byteLength} 字节]`
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
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
    setDeletingRow(rowIndex)
    setRowSaveError('')
    try {
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
    } finally {
      setDeletingRow(null)
    }
  }

  const sqlIdentifier = (value: string): string => `\`${value.replaceAll('`', '``')}\``

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

  return (
    <section className={`table-data-workspace${active ? ' active' : ''}`}>
      <div className="table-data-toolbar">
        <div className="table-data-location">
          <strong>{table.name}</strong><span>{connection.name} / {database.name}</span>
        </div>
        <button type="button" onClick={() => void loadData()} disabled={loading}><ArrowsClockwise />{loading ? '加载中…' : '刷新数据'}</button>
        <button type="button" onClick={() => onDesignTable(connection, database, table)}><PencilSimple />设计字段</button>
        <span className="table-data-toolbar-spacer" />
        <span className="table-data-page">第 {page + 1} 页 · 每页 {PAGE_SIZE} 行</span>
        <button type="button" className="table-data-page-button" disabled={loading || page === 0} onClick={() => setPage((current) => current - 1)} aria-label="上一页"><CaretLeft /></button>
        <button type="button" className="table-data-page-button" disabled={loading || rows.length < PAGE_SIZE} onClick={() => setPage((current) => current + 1)} aria-label="下一页"><CaretRight /></button>
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
      <div className={`query-message${rowSaveError || result && !result.success ? ' error' : result?.success ? ' success' : ''}`}>
        <span>{rowSaveError || result?.message || '正在加载数据…'}</span>
        {result?.editable
          ? <span className="query-editable-badge">支持编辑</span>
          : result?.success && <span className="table-readonly-badge">只读 · 表缺少主键</span>}
      </div>
      <div className="table-data-grid-wrap">
        {result?.success && result.columns && (
          <table className="query-table table-data-grid">
            <thead><tr>{result.editable && <th className="query-row-actions">操作</th>}{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{rows.map((row, index) => <tr key={index} className={editingCell?.rowIndex === index ? 'editing' : ''}>
              {result.editable && <td className="query-row-actions" onContextMenu={(event) => {
                event.preventDefault()
                setResultContextMenu({ x: Math.min(event.clientX, window.innerWidth - 196), y: Math.min(event.clientY, window.innerHeight - 190), rowIndex: index, column: '' })
              }}>
                <button type="button" className="delete-data-row" title="删除此行" disabled={deletingRow !== null || savingCell} onClick={() => void deleteRow(index)}><Trash /></button>
              </td>}
              {result.columns!.map((column) => {
                const editableColumn = result.editable?.columns.find((item) => item.resultName === column)
                const isEditing = editingCell?.rowIndex === index && editingCell.column === column
                return <td
                  key={column}
                  className={`${editableColumn ? 'editable-cell' : ''}${isEditing ? ' editing-cell' : ''}`}
                  onClick={() => editableColumn && !isEditing && startEditingCell(index, column)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setResultContextMenu({ x: Math.min(event.clientX, window.innerWidth - 196), y: Math.min(event.clientY, window.innerHeight - 190), rowIndex: index, column })
                  }}
                >
                  {isEditing
                    ? <span className="cell-editor">
                      <input
                        autoFocus
                        value={draftValue === null || draftValue === undefined ? '' : String(draftValue)}
                        onChange={(event) => setDraftValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveEditingCell()
                          if (event.key === 'Escape') setEditingCell(null)
                        }}
                      />
                      <button type="button" title="保存字段" disabled={savingCell} onClick={() => void saveEditingCell()}><FloppyDisk /></button>
                      <button type="button" title="取消编辑" disabled={savingCell} onClick={() => setEditingCell(null)}><X /></button>
                    </span>
                    : displayValue(row[column])}
                </td>
              })}
            </tr>)}</tbody>
          </table>
        )}
        {result?.success && !rows.length && <div className="table-data-empty">当前数据表中没有数据</div>}
      </div>
      {resultContextMenu && result?.rows?.[resultContextMenu.rowIndex] && (
        <div
          className="connection-context-menu query-result-context-menu"
          style={{ left: resultContextMenu.x, top: resultContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="danger" disabled={!result.editable} onClick={() => void deleteRow(resultContextMenu.rowIndex)}>
            <Trash />删除记录
          </button>
          <button type="button" disabled={!resultContextMenu.column} onClick={() => void copyText(resultContextMenu.column, '字段名称已复制')}>
            <Copy />复制字段名称
          </button>
          <span className="context-menu-divider" />
          <div className="context-submenu-host">
            <button type="button" disabled={!result.editable}><Copy /><span className="context-menu-label">复制为</span><CaretRight className="context-submenu-caret" /></button>
            {result.editable && <div className={`connection-context-menu context-submenu${resultContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => void copyText(buildInsertSql(resultContextMenu.rowIndex), '新增语句已复制')}><Copy />复制为新增语句</button>
              <button type="button" onClick={() => void copyText(buildUpdateSql(resultContextMenu.rowIndex), '修改语句已复制')}><Copy />复制为修改语句</button>
              <button type="button" disabled={!resultContextMenu.column} onClick={() => void copyText(resultContextMenu.column, '字段名称已复制')}><Copy />复制字段名称</button>
            </div>}
          </div>
        </div>
      )}
      {confirmDialog}
    </section>
  )
}

export default TableDataWorkspace
