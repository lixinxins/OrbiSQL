/**
 * 保存查询管理 hook
 * 支持 CRUD 操作、Cmd+S 快捷键保存、点击外部关闭下拉菜单。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueryExecutionResult, SavedQuery } from '@/shared/connections'
import { useGlobalCloseMenu } from '../../../hooks/useGlobalCloseMenu'

/** useSavedQueries 参数接口 */
export interface UseSavedQueriesParams {
  connectionId: number | null
  databaseName: string
  sql: string
  setSql: (sql: string) => void
  setResult: React.Dispatch<React.SetStateAction<QueryExecutionResult | null>>
  editorRef: React.RefObject<HTMLDivElement | null>
  confirm: (options: { title: string; message: string; detail: string; confirmLabel: string }) => Promise<boolean>
  active: boolean
}

/** useSavedQueries 返回值接口 */
export interface UseSavedQueriesReturn {
  savedQueries: SavedQuery[]
  showSavedQueries: boolean
  setShowSavedQueries: React.Dispatch<React.SetStateAction<boolean>>
  showSaveQueryDialog: boolean
  setShowSaveQueryDialog: React.Dispatch<React.SetStateAction<boolean>>
  saveQueryName: string
  setSaveQueryName: React.Dispatch<React.SetStateAction<string>>
  savingQuery: boolean
  saveQueryError: string
  setSaveQueryError: React.Dispatch<React.SetStateAction<string>>
  saveQueryNotice: string
  setSaveQueryNotice: React.Dispatch<React.SetStateAction<string>>
  savedQueriesHostRef: React.RefObject<HTMLDivElement | null>
  savedQueriesCloseTs: React.MutableRefObject<number>
  openSaveQueryDialog: () => void
  saveQuery: () => Promise<void>
  deleteSavedQuery: (savedQuery: SavedQuery) => Promise<void>
  loadSavedQueries: () => Promise<void>
}

/**
 * 保存查询管理 hook
 * @param params - 连接信息、SQL、编辑器 ref、确认弹窗回调等
 * @returns 保存查询列表、对话框状态、CRUD 操作方法
 */
export function useSavedQueries(params: UseSavedQueriesParams): UseSavedQueriesReturn {
  const { connectionId, databaseName, sql, setResult, confirm, active } = params

  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([])
  const [showSavedQueries, setShowSavedQueries] = useState(false)
  const [showSaveQueryDialog, setShowSaveQueryDialog] = useState(false)
  const [saveQueryName, setSaveQueryName] = useState('')
  const [savingQuery, setSavingQuery] = useState(false)
  const [saveQueryError, setSaveQueryError] = useState('')
  const [saveQueryNotice, setSaveQueryNotice] = useState('')
  const savedQueriesCloseTs = useRef(0)
  const savedQueriesHostRef = useRef<HTMLDivElement>(null)

  /** 从后端加载当前数据库的已保存查询列表 */
  const loadSavedQueries = async (): Promise<void> => {
    if (!connectionId || !databaseName) {
      setSavedQueries([])
      return
    }
    setSavedQueries(await window.omnidb.queries.listSaved(connectionId, databaseName))
  }

  useEffect(() => {
    void loadSavedQueries()
    setShowSavedQueries(false)
    setSaveQueryNotice('')
  }, [connectionId, databaseName])

  // 点击外部关闭下拉菜单
  useGlobalCloseMenu(showSavedQueries, () => { savedQueriesCloseTs.current = Date.now(); setShowSavedQueries(false) })

  /** 打开保存查询对话框，校验连接和 SQL 是否为空 */
  const openSaveQueryDialog = useCallback((): void => {
    if (!connectionId || !databaseName) {
      setResult({ success: false, message: '请先选择数据库，再保存查询语句' })
      return
    }
    if (!sql.trim()) {
      setResult({ success: false, message: '请输入要保存的 SQL 语句' })
      return
    }
    setSaveQueryName('')
    setSaveQueryError('')
    setShowSavedQueries(false)
    setShowSaveQueryDialog(true)
  }, [connectionId, databaseName, sql, setResult])

  /** 执行保存查询，调用后端 API 并刷新列表 */
  const saveQuery = async (): Promise<void> => {
    if (!connectionId || !databaseName || !saveQueryName.trim() || !sql.trim()) return
    setSavingQuery(true)
    setSaveQueryError('')
    try {
      const saved = await window.omnidb.queries.save({
        connectionId,
        databaseName,
        name: saveQueryName,
        sql
      })
      if (!saved.success) {
        setSaveQueryError(saved.message)
        return
      }
      setShowSaveQueryDialog(false)
      setSaveQueryNotice(`已保存：${saveQueryName.trim()}`)
      await loadSavedQueries()
    } finally {
      setSavingQuery(false)
    }
  }

  /** 删除已保存查询，弹出确认框后调用后端 API */
  const deleteSavedQuery = async (savedQuery: SavedQuery): Promise<void> => {
    if (!connectionId || !databaseName) return
    setShowSavedQueries(false)
    const confirmed = await confirm({
      title: '删除已保存的查询',
      message: `确定要删除查询"${savedQuery.name}"吗？`,
      detail: '只会删除 QuillDB 本地保存的查询记录，不会影响数据库中的任何数据。',
      confirmLabel: '删除查询'
    })
    if (!confirmed) return
    const deleted = await window.omnidb.queries.deleteSaved(savedQuery.id, connectionId, databaseName)
    if (!deleted.success) {
      setResult({ success: false, message: deleted.message })
      return
    }
    setSaveQueryNotice(`已删除：${savedQuery.name}`)
    await loadSavedQueries()
  }

  // Cmd+S / Ctrl+S 快捷键保存：仅当当前标签页处于 active 状态且对话框未打开时生效
  useEffect(() => {
    if (!active || showSaveQueryDialog) return
    const saveWithShortcut = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        openSaveQueryDialog()
      }
    }
    window.addEventListener('keydown', saveWithShortcut)
    return () => window.removeEventListener('keydown', saveWithShortcut)
  }, [active, showSaveQueryDialog, openSaveQueryDialog])

  return {
    savedQueries,
    showSavedQueries,
    setShowSavedQueries,
    showSaveQueryDialog,
    setShowSaveQueryDialog,
    saveQueryName,
    setSaveQueryName,
    savingQuery,
    saveQueryError,
    setSaveQueryError,
    saveQueryNotice,
    setSaveQueryNotice,
    savedQueriesHostRef,
    savedQueriesCloseTs,
    openSaveQueryDialog,
    saveQuery,
    deleteSavedQuery,
    loadSavedQueries
  }
}
