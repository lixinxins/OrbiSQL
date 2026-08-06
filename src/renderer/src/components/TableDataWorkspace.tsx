import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowLeft, ArrowLineLeft, ArrowLineRight, ArrowRight, ArrowsClockwise, ArrowsInLineHorizontal, Broom, CaretRight, Check, Code, Copy, DownloadSimple, FileCode, Funnel, GearSix, ListBullets, Minus, PencilSimple, Plus, Stop, Table as TableIcon, Trash, X } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, QueryExecutionResult, TableDataFilter, TableDataFilterCondition, TableDataFilterOperator, TableItem } from '@/shared/connections'
import { useConnectionStore } from '../stores/useConnectionStore'
import { useConfirmDialog } from './ConfirmDialog'
import { useToast } from '../contexts/ToastContext'
import { invalidateTableDataCache, readTableDataCached } from '../utils/table-data-cache'

interface TableDataWorkspaceProps {
  active: boolean
  connection: DatabaseConnection
  database: DatabaseItem
  table: TableItem
  onDesignTable: (connection: DatabaseConnection, database: DatabaseItem, table: TableItem) => void
}

const FILTER_OPERATOR_LABELS: Record<TableDataFilterOperator, string> = {
  contains: '包含',
  startsWith: '开头是',
  equals: '等于',
  notEquals: '不等于',
  greaterThan: '大于',
  greaterThanOrEqual: '大于等于',
  lessThan: '小于',
  lessThanOrEqual: '小于等于',
  isEmpty: '为空字符串',
  isNull: '为 NULL',
  isEmptyOrNull: '为空或 NULL',
  isNotEmpty: '非空且非 NULL',
  isNotNull: '不为 NULL'
}

function TableDataWorkspace({ active, connection, database, table, onDesignTable }: TableDataWorkspaceProps) {
  const { confirm, confirmDialog } = useConfirmDialog()
  const { showToast } = useToast()
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [result, setResult] = useState<QueryExecutionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null)
  const [draftValue, setDraftValue] = useState<unknown>('')
  const [savingCell, setSavingCell] = useState(false)
  const [rowSaveError, setRowSaveError] = useState('')
  const [filterDraft, setFilterDraft] = useState<TableDataFilterCondition[]>([
    { column: table.columns[0]?.name ?? '', operator: 'contains', value: '' }
  ])
  const [filterLogic, setFilterLogic] = useState<'AND' | 'OR'>('AND')
  const [appliedFilter, setAppliedFilter] = useState<TableDataFilter | undefined>()
  const [resultContextMenu, setResultContextMenu] = useState<{ x: number; y: number; rowIndex: number; column: string } | null>(null)
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)
  const [newRowDraft, setNewRowDraft] = useState<Record<string, unknown> | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'record'>('grid')
  const [showPageSize, setShowPageSize] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState<number>(0)
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [detailModal, setDetailModal] = useState<{ rowIndex: number; column: string; text: string } | null>(null)
  const loadRequestId = useRef(0)

  // P2: 数据网格虚拟化
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const gridVirtualizer = useVirtualizer({
    count: result?.rows?.length ?? 0,
    getScrollElement: () => gridScrollRef.current,
    estimateSize: () => 33,
    overscan: 10
  })

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

  const loadData = useCallback(async (force = false): Promise<void> => {
    const requestId = ++loadRequestId.current
    setLoading(true)
    setEditingCell(null)
    setSelectedRowIndex(null)
    setNewRowDraft(null)
    setRowSaveError('')
    try {
      const res = await readTableDataCached(
        connection.id,
        database.name,
        table.name,
        pageSize,
        page * pageSize,
        appliedFilter,
        { force }
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
      void loadData(true)
    }, autoRefresh * 1000)
    return () => clearInterval(timer)
  }, [active, autoRefresh, loadData])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const displayValue = useCallback((value: unknown): ReactNode => {
    if (value === null) return <span className="cell-null">NULL</span>
    if (value instanceof Uint8Array) return <span className="cell-badge binary">[BLOB {value.byteLength} B]</span>
    if (value instanceof Date) {
      const pad = (n: number): string => String(n).padStart(2, '0')
      const text = Number.isNaN(value.getTime())
        ? String(value)
        : `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
      return <span className="cell-date" title={text}>{text}</span>
    }
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
          <span className="pg-badge">JSON</span>
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
  }, [])

  // P2: 可编辑字段缓存（避免每个单元格重复 .find 遍历）
  const editableColumnMap = useMemo(() => {
    const map = new Map<string, NonNullable<QueryExecutionResult['editable']>['columns'][number]>()
    if (result?.editable) for (const col of result.editable.columns) map.set(col.resultName, col)
    return map
  }, [result?.editable])
  const primaryKeyColumns = useMemo(() => result?.editable?.columns.filter((c) => c.primaryKey) ?? [], [result?.editable])
  const nonPrimaryKeyColumns = useMemo(() => result?.editable?.columns.filter((c) => !c.primaryKey) ?? [], [result?.editable])
  const editableColumnNames = useMemo(() => new Set(editableColumnMap.keys()), [editableColumnMap])

  const startEditingCell = (rowIndex: number, column: string): void => {
    if (!result?.rows?.[rowIndex] || !editableColumnNames.has(column)) return
    setEditingCell({ rowIndex, column })
    setDraftValue(result.rows[rowIndex][column])
    setRowSaveError('')
  }

  const saveEditingCell = async (): Promise<void> => {
    if (!editingCell || !result?.rows?.[editingCell.rowIndex] || !result.editable) return
    const originalRow = result.rows[editingCell.rowIndex]
    const column = editableColumnMap.get(editingCell.column)
    if (!column) return
    if (draftValue === originalRow[editingCell.column]) {
      setEditingCell(null)
      return
    }
    const primaryKeyValues: Record<string, unknown> = {}
    for (const col of primaryKeyColumns) {
      primaryKeyValues[col.sourceName] = originalRow[col.resultName]
    }

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
      invalidateTableDataCache(connection.id, database.name, table.name)
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
    for (const col of primaryKeyColumns) {
      primaryKeyValues[col.sourceName] = row[col.resultName]
    }
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
    invalidateTableDataCache(connection.id, database.name, table.name)
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
    const changedColumns = nonPrimaryKeyColumns
    const primaryKeys = primaryKeyColumns
    return `UPDATE ${sqlIdentifier(database.name)}.${sqlIdentifier(table.name)} SET ${changedColumns.map((column) => `${sqlIdentifier(column.sourceName)} = ${sqlValue(row[column.resultName])}`).join(', ')} WHERE ${primaryKeys.map((column) => `${sqlIdentifier(column.sourceName)} <=> ${sqlValue(row[column.resultName])}`).join(' AND ')};`
  }

  const rows = result?.rows ?? []

  const [customColumnWidths, setCustomColumnWidths] = useState<Record<string, number>>({})
  const resizerRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null)

  // 计算各列最佳宽度以保证 100% 像素级对齐（支持用户手动拖动列宽）
  const columnWidthMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!result?.columns) return map
    for (const col of result.columns) {
      if (customColumnWidths[col] !== undefined) {
        map.set(col, customColumnWidths[col])
        continue
      }
      let maxLen = col.length
      if (rows) {
        const sampleCount = Math.min(rows.length, 50)
        for (let i = 0; i < sampleCount; i++) {
          const val = rows[i][col]
          const strLen = val === null || val === undefined ? 4 : String(val).length
          if (strLen > maxLen) maxLen = strLen
        }
      }
      const calculatedWidth = Math.min(Math.max(maxLen * 9 + 32, 130), 400)
      map.set(col, calculatedWidth)
    }
    return map
  }, [result?.columns, rows, customColumnWidths])

  const handleColumnResizeStart = (e: React.MouseEvent, column: string): void => {
    e.preventDefault()
    e.stopPropagation()
    const startWidth = columnWidthMap.get(column) ?? 150
    resizerRef.current = { col: column, startX: e.clientX, startWidth }

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      if (!resizerRef.current) return
      const deltaX = moveEvent.clientX - resizerRef.current.startX
      const newWidth = Math.max(resizerRef.current.startWidth + deltaX, 70)
      setCustomColumnWidths((prev) => ({ ...prev, [resizerRef.current!.col]: newWidth }))
    }

    const handleMouseUp = (): void => {
      resizerRef.current = null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }
  const availableColumns = table.columns.length ? table.columns.map((c) => c.name) : result?.columns ?? []
  const filterNeedsValue = (operator: TableDataFilterOperator): boolean =>
    !['isEmpty', 'isEmptyOrNull', 'isNotEmpty', 'isNull', 'isNotNull'].includes(operator)
  const validFilterRows = filterDraft.filter((row) =>
    row.column && (!filterNeedsValue(row.operator) || row.value.trim() !== '')
  )
  const canApplyFilter = validFilterRows.length > 0

  const updateFilterRow = (index: number, patch: Partial<TableDataFilterCondition>): void => {
    setFilterDraft((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const addFilterRow = (): void => {
    setFilterDraft((current) => [
      ...current,
      { column: availableColumns[0] ?? '', operator: 'contains', value: '' }
    ])
  }

  const removeFilterRow = (index: number): void => {
    setFilterDraft((current) => {
      const next = current.filter((_, i) => i !== index)
      // 删空后保留一行空条件，避免筛选面板消失
      return next.length ? next : [{ column: availableColumns[0] ?? '', operator: 'contains', value: '' }]
    })
  }

  const removeAppliedCondition = (index: number): void => {
    if (!appliedFilter) return
    const nextFilters = appliedFilter.filters.filter((_, i) => i !== index)
    setPage(0)
    if (!nextFilters.length) {
      setAppliedFilter(undefined)
    } else {
      setAppliedFilter({ ...appliedFilter, filters: nextFilters })
    }
  }

  const applyFilter = (): void => {
    if (!canApplyFilter) return
    setPage(0)
    setAppliedFilter({
      filters: validFilterRows.map((row) => ({ column: row.column, operator: row.operator, value: row.value })),
      logic: filterLogic
    })
  }

  const resetFilter = (): void => {
    setPage(0)
    setAppliedFilter(undefined)
    setFilterLogic('AND')
    setFilterDraft([{ column: table.columns[0]?.name ?? '', operator: 'contains', value: '' }])
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
      const isPk = editableColumnMap.get(col)?.primaryKey
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
        <button type="button" onClick={() => onDesignTable(connection, database, table)}><PencilSimple />设计字段</button>
        <button
          type="button"
          onClick={() => {
            void useConnectionStore.getState().actions.refreshTable(connection.id, database.name, table.name)
            void loadData()
          }}
          title="刷新当前数据表"
        >
          <ArrowsClockwise />刷新表
        </button>
        <span className="table-data-toolbar-divider" />
        <button type="button" disabled={!result?.rows?.length} onClick={() => exportGridData('csv')}><DownloadSimple />导出 CSV</button>
        <button type="button" disabled={!result?.rows?.length} onClick={() => exportGridData('json')}><DownloadSimple />导出 JSON</button>
        <span className="table-data-toolbar-divider" />
        <button
          type="button"
          className={`table-data-filter-toggle${filterExpanded ? ' active' : ''}${appliedFilter ? ' has-filter' : ''}`}
          onClick={() => setFilterExpanded((current) => !current)}
          title={filterExpanded ? '收起筛选' : '展开筛选'}
        >
          <Funnel weight={appliedFilter ? 'fill' : 'regular'} />
          筛选
          {appliedFilter && <span className="filter-applied-dot" />}
        </button>
        <span className="table-data-toolbar-spacer" />
        <div className="table-data-location">
          <strong>{table.name}</strong><span>{connection.name} / {database.name}</span>
        </div>
      </div>
      {filterExpanded && (
        <div className="table-data-filter">
          <div className="table-data-filter-header">
            <span className="filter-panel-title"><Funnel size={13} weight="duotone" />筛选条件</span>
            <div className="filter-logic-switch" role="group" aria-label="条件组合方式">
              <button
                type="button"
                className={filterLogic === 'AND' ? 'active' : ''}
                onClick={() => setFilterLogic('AND')}
                title="所有条件都满足时匹配"
              >
                满足全部（AND）
              </button>
              <button
                type="button"
                className={filterLogic === 'OR' ? 'active' : ''}
                onClick={() => setFilterLogic('OR')}
                title="任一条件满足时匹配"
              >
                满足任一（OR）
              </button>
            </div>
            <span className="table-data-filter-header-spacer" />
            {appliedFilter && (
              <div className="table-data-applied-filters">
                {appliedFilter.filters.map((cond, index) => (
                  <span className="applied-filter-chip" key={`${cond.column}-${index}`}>
                    <span className="applied-filter-text">
                      {cond.column} {FILTER_OPERATOR_LABELS[cond.operator]}{cond.value ? ` ${cond.value}` : ''}
                    </span>
                    <button
                      type="button"
                      className="applied-filter-remove"
                      title="删除该条件"
                      onClick={() => removeAppliedCondition(index)}
                    >
                      <X size={12} weight="bold" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              className="filter-panel-close"
              title="收起筛选"
              onClick={() => setFilterExpanded(false)}
            >
              <X size={13} weight="bold" />
            </button>
          </div>
          <div className="table-data-filter-rows">
            {filterDraft.map((row, index) => (
              <div className="table-data-filter-row" key={index}>
                <span className="filter-row-index">{String(index + 1).padStart(2, '0')}</span>
                <select
                  className="filter-row-field"
                  value={row.column}
                  onChange={(event) => updateFilterRow(index, { column: event.target.value })}
                  aria-label="筛选字段"
                >
                  {!availableColumns.length && <option value="">暂无字段</option>}
                  {availableColumns.map((column) => <option value={column} key={column}>{column}</option>)}
                </select>
                <select
                  className="filter-row-operator"
                  value={row.operator}
                  onChange={(event) => updateFilterRow(index, { operator: event.target.value as TableDataFilterOperator })}
                  aria-label="筛选条件"
                >
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
                  className="filter-row-value"
                  value={row.value}
                  disabled={!filterNeedsValue(row.operator)}
                  onChange={(event) => updateFilterRow(index, { value: event.target.value })}
                  onKeyDown={(event) => { if (event.key === 'Enter') applyFilter() }}
                  placeholder={filterNeedsValue(row.operator) ? '输入筛选值' : '不需要输入值'}
                />
                <button
                  type="button"
                  className="filter-row-remove"
                  title="删除该条件"
                  onClick={() => removeFilterRow(index)}
                >
                  <X size={14} weight="bold" />
                </button>
              </div>
            ))}
          </div>
          <div className="table-data-filter-actions">
            <button type="button" className="filter-add-row" onClick={addFilterRow}><Plus size={13} weight="bold" />添加条件</button>
            <span className="table-data-filter-actions-spacer" />
            <button type="button" className="reset-filter" disabled={!appliedFilter} onClick={resetFilter}><X size={12} weight="bold" />清空筛选</button>
            <button type="button" className="apply-filter" disabled={!canApplyFilter} onClick={applyFilter}><Check size={13} weight="bold" />应用筛选</button>
          </div>
        </div>
      )}
      {(rowSaveError || result && !result.success) && <div className="query-message error">
        <span>{rowSaveError || result?.message}</span>
      </div>}
      <div className="table-data-grid-wrap virtual-scroll" ref={gridScrollRef}>
        {viewMode === 'grid' && result?.success && result.columns && (
          <table className="query-table table-data-grid">
            <thead>
              <tr>
                {result.columns.map((column) => {
                  const isPk = editableColumnMap.get(column)?.primaryKey
                  const width = columnWidthMap.get(column) ?? 150
                  return (
                    <th key={column} className="th-resizable" style={{ width: `${width}px`, minWidth: `${width}px` }}>
                      {isPk && <span title="主键 Primary Key" style={{ cursor: 'help' }}>🔑 </span>}
                      <span>{column}</span>
                      <div
                        className="th-resizer"
                        title="拖动调整列宽"
                        onMouseDown={(event) => handleColumnResizeStart(event, column)}
                      />
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="virtual-tbody" style={{ height: `${gridVirtualizer.getTotalSize() + (newRowDraft ? 33 : 0)}px` }}>
            {newRowDraft && <tr className="new-data-row" style={{ height: '33px', position: 'absolute', left: 0, right: 0, transform: 'translateY(0px)' }}>
              {result.columns.map((column) => {
                const width = columnWidthMap.get(column) ?? 150
                return <td key={column} className="editing-cell" style={{ width: `${width}px`, minWidth: `${width}px` }}>
                  <input
                    value={newRowDraft[column] === undefined || newRowDraft[column] === null ? '' : String(newRowDraft[column])}
                    placeholder="默认值"
                    onChange={(event) => setNewRowDraft((current) => current ? { ...current, [column]: event.target.value } : current)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveNewRow()
                      if (event.key === 'Escape') cancelPendingChange()
                    }}
                  />
                </td>
              })}
            </tr>}
            {gridVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              const offsetY = virtualRow.start + (newRowDraft ? 33 : 0)
              return <tr key={virtualRow.index} className={`${editingCell?.rowIndex === virtualRow.index ? 'editing ' : ''}${selectedRowIndex === virtualRow.index ? 'selected' : ''}`} style={{ height: `${virtualRow.size}px`, transform: `translateY(${offsetY}px)` }}>
                {result.columns!.map((column) => {
                  const editableColumn = editableColumnMap.get(column)
                  const isEditing = editingCell?.rowIndex === virtualRow.index && editingCell.column === column
                  const width = columnWidthMap.get(column) ?? 150
                  return <td
                    key={column}
                    className={`${editableColumn ? 'editable-cell' : ''}${isEditing ? ' editing-cell table-data-editing-cell' : ''}`}
                    style={{ width: `${width}px`, minWidth: `${width}px` }}
                    onClick={() => {
                      setSelectedRowIndex(virtualRow.index)
                      if (editableColumn && !isEditing) startEditingCell(virtualRow.index, column)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setResultContextMenu({ x: Math.min(event.clientX, window.innerWidth - 196), y: Math.min(event.clientY, window.innerHeight - 190), rowIndex: virtualRow.index, column })
                    }}
                  >
                    {isEditing
                      ? <span className="cell-editor table-data-cell-editor" onClick={(event) => event.stopPropagation()}>
                        <input
                          autoFocus
                          value={draftValue === null || draftValue === undefined ? '' : String(draftValue)}
                          onChange={(event) => setDraftValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void saveEditingCell()
                            if (event.key === 'Escape') setEditingCell(null)
                          }}
                        />
                        <button type="button" className="editor-btn null-btn" title="设为 NULL" onClick={() => setDraftValue(null)}>NULL</button>
                        <button type="button" className="editor-btn empty-btn" title="设为空字符串" onClick={() => setDraftValue('')}>EMPTY</button>
                        <button type="button" className="editor-btn save-btn" title="保存 (Enter)" onClick={() => void saveEditingCell()}><Check weight="bold" />保存</button>
                        <button type="button" className="editor-btn cancel-btn" title="取消 (Esc)" onClick={() => setEditingCell(null)}><X />取消</button>
                      </span>
                      : displayValue(row[column])}
                  </td>
                })}
              </tr>
            })}
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
        {loading && <div className="table-data-loading"><span>加载中…</span></div>}
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
        <div className="text-detail-backdrop" onClick={() => setDetailModal(null)}>
          <div className="text-detail-dialog" onClick={(e) => e.stopPropagation()}>
            <header className="text-detail-header">
              <div className="text-detail-title-group">
                <div className="text-detail-icon"><FileCode weight="duotone" /></div>
                <div className="text-detail-title-info">
                  <strong>
                    查看 / 编辑大文本与 JSON
                    <span className="text-detail-column-badge">{detailModal.column}</span>
                  </strong>
                  <small>{detailModal.text.length} 字符 · {detailModal.text.split('\n').length} 行</small>
                </div>
              </div>
              <button type="button" className="text-detail-close-btn" onClick={() => setDetailModal(null)} title="关闭"><X /></button>
            </header>

            <div className="text-detail-toolbar">
              <button type="button" className="text-detail-tool-btn" title="格式化 JSON 字符串" onClick={() => {
                try {
                  const formatted = JSON.stringify(JSON.parse(detailModal.text), null, 2)
                  setDetailModal({ ...detailModal, text: formatted })
                  showToast('success', '已格式化为标准 JSON 格式')
                } catch {
                  showToast('error', '当前文本不是有效的 JSON 格式')
                }
              }}>
                <Code />格式化 JSON
              </button>
              <button type="button" className="text-detail-tool-btn" title="压缩 JSON（去除换行与空格）" onClick={() => {
                try {
                  const minified = JSON.stringify(JSON.parse(detailModal.text))
                  setDetailModal({ ...detailModal, text: minified })
                  showToast('success', '已压缩 JSON 字符串')
                } catch {
                  showToast('error', '当前文本不是有效的 JSON 格式')
                }
              }}>
                <ArrowsInLineHorizontal />压缩 JSON
              </button>
              <button type="button" className="text-detail-tool-btn" title="清空所有文本" onClick={() => setDetailModal({ ...detailModal, text: '' })}>
                <Broom />清空文本
              </button>
              <button type="button" className="text-detail-tool-btn" title="复制文本到剪贴板" onClick={() => void copyText(detailModal.text, '文本内容已复制')}>
                <Copy />复制内容
              </button>
            </div>

            <div className="text-detail-editor-body">
              <textarea
                className="text-detail-textarea"
                value={detailModal.text}
                onChange={(e) => setDetailModal({ ...detailModal, text: e.target.value })}
                placeholder="请输入长文本或 JSON 内容..."
                autoFocus
              />
            </div>

            <footer className="text-detail-footer">
              <div className="text-detail-footer-status">
                {(() => {
                  if (!detailModal.text.trim()) return <span>为空内容</span>
                  try {
                    JSON.parse(detailModal.text)
                    return <span className="text-detail-status-pill valid">✓ 标准 JSON 格式</span>
                  } catch {
                    return <span className="text-detail-status-pill invalid">纯文本 / 字符串</span>
                  }
                })()}
              </div>

              <div className="text-detail-footer-actions">
                <button type="button" className="text-detail-cancel-btn" onClick={() => setDetailModal(null)}>取消</button>
                <button type="button" className="text-detail-save-btn" onClick={() => {
                  startEditingCell(detailModal.rowIndex, detailModal.column)
                  setDraftValue(detailModal.text)
                  setDetailModal(null)
                }}><Check weight="bold" />填入单元格并保存</button>
              </div>
            </footer>
          </div>
        </div>
      )}
      {confirmDialog}
    </section>
  )
}

export default TableDataWorkspace
