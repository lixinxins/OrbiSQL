/**
 * 单元格编辑状态管理 hook
 * 处理行级保存/删除操作、右键菜单、剪贴板复制等。
 * result 变化时自动清除编辑状态，避免旧数据残留。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { QueryExecutionResult, QueryEditableColumn } from '@/shared/connections'

/** useCellEditing 参数接口 */
export interface UseCellEditingParams {
  result: QueryExecutionResult | null
  setResult: React.Dispatch<React.SetStateAction<QueryExecutionResult | null>>
  connectionId: number | null
  databaseName: string
  confirm: (options: { title: string; message: string; detail: string; confirmLabel: string }) => Promise<boolean>
  setResultPanelTab: React.Dispatch<React.SetStateAction<'message' | 'summary' | 'result'>>
}

/** useCellEditing 返回值接口 */
export interface UseCellEditingReturn {
  editingCell: { rowIndex: number; column: string } | null
  setEditingCell: React.Dispatch<React.SetStateAction<{ rowIndex: number; column: string } | null>>
  draftCellValue: unknown
  setDraftCellValue: React.Dispatch<React.SetStateAction<unknown>>
  savingRow: boolean
  rowSaveError: string
  resultContextMenu: { x: number; y: number; rowIndex: number; column: string } | null
  setResultContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; rowIndex: number; column: string } | null>>
  errorCopied: boolean
  editableColumnMap: Map<string, QueryEditableColumn>
  primaryKeyColumns: QueryEditableColumn[]
  nonPrimaryKeyColumns: QueryEditableColumn[]
  startEditingCell: (rowIndex: number, column: string) => void
  saveEditingCell: () => Promise<void>
  deleteResultRow: (rowIndex: number) => Promise<void>
  copyText: (text: string, successMessage: string) => Promise<void>
  copyErrorMessage: () => Promise<void>
}

/**
 * 单元格编辑状态管理 hook
 * @param params - 查询结果、连接信息、确认弹窗回调等
 * @returns 编辑状态、右键菜单、可编辑列缓存、保存/删除/复制方法
 */
export function useCellEditing({
  result,
  setResult,
  connectionId,
  databaseName,
  confirm,
  setResultPanelTab
}: UseCellEditingParams): UseCellEditingReturn {
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null)
  const [draftCellValue, setDraftCellValue] = useState<unknown>('')
  const [savingRow, setSavingRow] = useState(false)
  const [rowSaveError, setRowSaveError] = useState('')
  const [resultContextMenu, setResultContextMenu] = useState<{ x: number; y: number; rowIndex: number; column: string } | null>(null)
  const [errorCopied, setErrorCopied] = useState(false)

  // result 变化时清除编辑状态（替代原 execute() 中的 setEditingCell(null) / setRowSaveError('')）
  useEffect(() => {
    setEditingCell(null)
    setRowSaveError('')
  }, [result])

  // 点击外部关闭右键菜单
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

  // P2: 可编辑字段缓存（避免每个单元格重复 .find 遍历）
  const editableColumnMap = useMemo(() => {
    const map = new Map<string, QueryEditableColumn>()
    if (result?.editable) for (const col of result.editable.columns) map.set(col.resultName, col)
    return map
  }, [result?.editable])
  const primaryKeyColumns = useMemo(() => result?.editable?.columns.filter((c) => c.primaryKey) ?? [], [result?.editable])
  const nonPrimaryKeyColumns = useMemo(() => result?.editable?.columns.filter((c) => !c.primaryKey) ?? [], [result?.editable])
  const editableColumnNames = useMemo(() => new Set(editableColumnMap.keys()), [editableColumnMap])

  /** 开始编辑指定单元格，加载当前值作为草稿 */
  const startEditingCell = useCallback((rowIndex: number, column: string): void => {
    if (!result?.rows?.[rowIndex] || !editableColumnNames.has(column) || savingRow) return
    setEditingCell({ rowIndex, column })
    setDraftCellValue(result.rows[rowIndex][column])
    setRowSaveError('')
  }, [result, editableColumnNames, savingRow])

  /**
   * 保存当前编辑的单元格
   * 通过主键值定位行，调用后端 updateRow API 更新单个字段。
   */
  const saveEditingCell = useCallback(async (): Promise<void> => {
    if (!editingCell || !result?.rows?.[editingCell.rowIndex] || !result.editable || !connectionId) return
    const activeCell = editingCell
    const originalRow = result.rows[activeCell.rowIndex]
    const editableColumn = editableColumnMap.get(activeCell.column)
    if (!editableColumn) return
    const primaryKeyValues: Record<string, unknown> = {}
    for (const column of primaryKeyColumns) {
      primaryKeyValues[column.sourceName] = originalRow[column.resultName]
    }
    if (draftCellValue === originalRow[activeCell.column]) {
      setEditingCell(null)
      return
    }
    setSavingRow(true)
    try {
      const saved = await window.omnidb.queries.updateRow({
        connectionId,
        databaseName,
        tableName: result.editable.tableName,
        primaryKeyValues,
        changes: { [editableColumn.sourceName]: draftCellValue }
      })
      if (!saved.success) {
        setRowSaveError(saved.message)
        setResultPanelTab('message')
        return
      }
      setResult((current) => current?.rows ? {
        ...current,
        success: true,
        message: saved.message,
        rows: current.rows.map((row, index) => index === activeCell.rowIndex ? { ...row, [activeCell.column]: draftCellValue } : row)
      } : current)
      setRowSaveError('')
      setEditingCell(null)
    } finally {
      setSavingRow(false)
    }
  }, [editingCell, result, connectionId, databaseName, editableColumnMap, primaryKeyColumns, draftCellValue, setResultPanelTab])

  /** 复制文本到剪贴板，成功后更新结果消息 */
  const copyText = useCallback(async (text: string, successMessage: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setRowSaveError('')
      setResult((current) => current ? { ...current, message: successMessage } : current)
    } catch {
      setRowSaveError('复制失败，请检查剪贴板权限')
    } finally {
      setResultContextMenu(null)
    }
  }, [setResult])

  const errorCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 组件卸载时清理 setTimeout
  useEffect(() => () => {
    if (errorCopiedTimerRef.current) clearTimeout(errorCopiedTimerRef.current)
  }, [])

  /** 复制错误信息到剪贴板，2 秒后自动重置“已复制”状态 */
  const copyErrorMessage = useCallback(async (): Promise<void> => {
    const text = rowSaveError || result?.message || ''
    try {
      await navigator.clipboard.writeText(text)
      setErrorCopied(true)
      if (errorCopiedTimerRef.current) clearTimeout(errorCopiedTimerRef.current)
      errorCopiedTimerRef.current = setTimeout(() => setErrorCopied(false), 2000)
    } catch {
      return
    }
  }, [rowSaveError, result?.message])

  /** 删除指定行，弹出确认框后调用后端 API */
  const deleteResultRow = useCallback(async (rowIndex: number): Promise<void> => {
    if (!result?.editable || !result.rows?.[rowIndex] || !connectionId) return
    setResultContextMenu(null)
    const confirmed = await confirm({
      title: '删除数据记录',
      message: `确定要删除表"${result.editable.tableName}"中的这条记录吗？`,
      detail: '该记录会从数据库中永久删除，此操作无法撤销。',
      confirmLabel: '删除记录'
    })
    if (!confirmed) return
    const row = result.rows[rowIndex]
    const primaryKeyValues: Record<string, unknown> = {}
    for (const column of primaryKeyColumns) {
      primaryKeyValues[column.sourceName] = row[column.resultName]
    }
    const deleted = await window.omnidb.tables.deleteRow({
      connectionId,
      databaseName,
      tableName: result.editable.tableName,
      primaryKeyValues
    })
    if (!deleted.success) {
      setRowSaveError(deleted.message)
      setResultPanelTab('message')
      return
    }
    setResult((current) => current?.rows ? {
      ...current,
      success: true,
      message: deleted.message,
      rows: current.rows.filter((_, index) => index !== rowIndex)
    } : current)
    setEditingCell(null)
    setRowSaveError('')
  }, [result, connectionId, databaseName, confirm, primaryKeyColumns, setResultPanelTab])

  return {
    editingCell,
    setEditingCell,
    draftCellValue,
    setDraftCellValue,
    savingRow,
    rowSaveError,
    resultContextMenu,
    setResultContextMenu,
    errorCopied,
    editableColumnMap,
    primaryKeyColumns,
    nonPrimaryKeyColumns,
    startEditingCell,
    saveEditingCell,
    deleteResultRow,
    copyText,
    copyErrorMessage
  }
}
