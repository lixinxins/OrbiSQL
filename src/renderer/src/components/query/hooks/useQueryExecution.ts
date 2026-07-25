/**
 * 查询执行核心 hook
 * 管理 SQL 执行状态（running/result/loadingMore）和事务控制。
 * result 是最关键的共享状态，被 useCellEditing 等多个 hook 通过参数接收。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { QueryExecutionResult } from '@/shared/connections'

/** useQueryExecution 参数接口 */
export interface UseQueryExecutionParams {
  sessionId: string
  connectionId: number | null
  databaseName: string
  sql: string
  engine?: string
  autoRun?: boolean
  setResultPanelVisible: React.Dispatch<React.SetStateAction<boolean>>
  setResultPanelTab: React.Dispatch<React.SetStateAction<'message' | 'summary' | 'result'>>
  setResultDataTab: React.Dispatch<React.SetStateAction<'data' | 'chart' | 'info'>>
  setResultPanelCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  setSqlHistory: React.Dispatch<React.SetStateAction<{ sql: string; ts: number; success: boolean }[]>>
  setFormatError: React.Dispatch<React.SetStateAction<string>>
}

/** useQueryExecution 返回值接口 */
export interface UseQueryExecutionReturn {
  running: boolean
  result: QueryExecutionResult | null
  setResult: React.Dispatch<React.SetStateAction<QueryExecutionResult | null>>
  loadingMore: boolean
  transactionActive: boolean
  transactionBusy: boolean
  execute: () => Promise<void>
  executeExplain: () => Promise<void>
  handleLoadMore: () => Promise<void>
  beginTransaction: () => Promise<void>
  finishTransaction: (commit: boolean) => Promise<void>
}

/**
 * 查询执行核心 hook
 * @param params - 包含连接信息、SQL、引擎类型以及各状态更新回调
 * @returns 执行状态、事务控制方法、结果数据及操作函数
 */
export function useQueryExecution({
  sessionId,
  connectionId,
  databaseName,
  sql,
  engine,
  autoRun,
  setResultPanelVisible,
  setResultPanelTab,
  setResultDataTab,
  setResultPanelCollapsed,
  setSqlHistory,
  setFormatError
}: UseQueryExecutionParams): UseQueryExecutionReturn {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<QueryExecutionResult | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [transactionActive, setTransactionActive] = useState(false)
  const [transactionBusy, setTransactionBusy] = useState(false)
  // 事务状态 ref，用于卸载时回滚（避免闭包捕获过期 state）
  const transactionActiveRef = useRef(false)
  // 标记 autoRun 是否已触发，确保只执行一次
  const autoRunStarted = useRef(false)

  // 组件卸载时回滚未提交的事务
  useEffect(() => () => {
    if (transactionActiveRef.current) void window.omnidb.queries.rollbackTransaction(sessionId)
  }, [sessionId])

  /**
   * 分页加载更多结果行
   * 通过 cursorId 从后端继续获取数据，合并到现有 result.rows 中。
   */
  const handleLoadMore = useCallback(async (): Promise<void> => {
    if (!result?.cursorId || !connectionId || !databaseName || loadingMore) return
    setLoadingMore(true)
    try {
      const response = await window.omnidb.queries.fetchMore(connectionId, databaseName, result.cursorId)
      if (response.success && response.rows) {
        setResult((prev) => {
          if (!prev?.rows) return prev
          const newRows = response.rows ?? []
          const mergedRows = [...prev.rows, ...newRows]
          return {
            ...prev,
            rows: mergedRows,
            truncated: !response.done,
            cursorId: response.done ? undefined : prev.cursorId,
            totalRows: response.totalRows ?? prev.totalRows
          }
        })
      }
    } finally {
      setLoadingMore(false)
    }
  }, [result, connectionId, databaseName, loadingMore])

  /**
   * 执行当前 SQL
   * 支持单语句和多语句批量执行，执行后自动记录到历史。
   */
  const execute = useCallback(async (): Promise<void> => {
    if (!connectionId || !databaseName) {
      setResult({ success: false, message: '请先选择数据库' })
      setResultPanelVisible(true)
      setResultPanelTab('message')
      setResultPanelCollapsed(false)
      return
    }
    setRunning(true)
    try {
      const nextResult = await window.omnidb.queries.execute(connectionId, databaseName, sql, transactionActive ? sessionId : undefined)
      setResult(nextResult)
      setResultPanelVisible(true)
      setResultPanelTab(nextResult.success && nextResult.columns && nextResult.rows ? 'result' : 'message')
      setResultDataTab('data')
      setResultPanelCollapsed(false)
      // Save to history
      setSqlHistory((prev) => {
        const entry = { sql: sql.trim(), ts: Date.now(), success: nextResult.success }
        return [entry, ...prev.filter((h) => h.sql !== sql.trim())].slice(0, 50)
      })
    } finally {
      setRunning(false)
    }
  }, [connectionId, databaseName, sql, transactionActive, sessionId, setResultPanelVisible, setResultPanelTab, setResultDataTab, setResultPanelCollapsed, setSqlHistory])

  /**
   * 开启事务
   * 通过 sessionId 关联服务端事务会话，后续 execute 调用会携带 sessionId。
   */
  const beginTransaction = useCallback(async (): Promise<void> => {
    if (!connectionId || !databaseName || transactionActive) return
    setTransactionBusy(true)
    const response = await window.omnidb.queries.beginTransaction(connectionId, databaseName, sessionId)
    setTransactionBusy(false)
    if (response.success) {
      transactionActiveRef.current = true
      setTransactionActive(true)
    }
    setResult({ success: response.success, message: response.message, queryCount: 0, successCount: 0, errorCount: response.success ? 0 : 1 })
    setResultPanelVisible(true)
    setResultPanelTab('message')
  }, [connectionId, databaseName, transactionActive, sessionId])

  /**
   * 结束事务（提交或回滚）
   * @param commit - true 为 COMMIT，false 为 ROLLBACK
   */
  const finishTransaction = useCallback(async (commit: boolean): Promise<void> => {
    if (!transactionActive) return
    setTransactionBusy(true)
    const response = commit
      ? await window.omnidb.queries.commitTransaction(sessionId)
      : await window.omnidb.queries.rollbackTransaction(sessionId)
    setTransactionBusy(false)
    if (response.success) {
      transactionActiveRef.current = false
      setTransactionActive(false)
    }
    setResult({ success: response.success, message: response.message, queryCount: 0, successCount: 0, errorCount: response.success ? 0 : 1 })
    setResultPanelVisible(true)
    setResultPanelTab('message')
  }, [transactionActive, sessionId])

  /**
   * 执行 EXPLAIN 分析
   * 自动为 SQL 添加 EXPLAIN / EXPLAIN ANALYZE 前缀（PostgreSQL 使用 ANALYZE）。
   */
  const executeExplain = useCallback(async (): Promise<void> => {
    if (!connectionId || !databaseName || !sql.trim() || running) return
    const isPg = engine === 'PostgreSQL'
    const explainSql = sql.trim().toUpperCase().startsWith('EXPLAIN')
      ? sql
      : isPg ? `EXPLAIN ANALYZE ${sql}` : `EXPLAIN ${sql}`

    setRunning(true)
    setResultPanelVisible(true)
    setResultPanelCollapsed(false)
    setFormatError('')
    try {
      const res = await window.omnidb.queries.execute(connectionId, databaseName, explainSql, transactionActive ? sessionId : undefined)
      setResult(res)
    } catch (err) {
      setResult({ success: false, message: err instanceof Error ? err.message : '分析执行计划失败' })
    } finally {
      setRunning(false)
    }
  }, [connectionId, databaseName, sql, running, engine, transactionActive, sessionId, setResultPanelVisible, setResultPanelCollapsed, setFormatError])

  // autoRun 首次执行
  useEffect(() => {
    if (!autoRun || autoRunStarted.current) return
    autoRunStarted.current = true
    void execute()
  }, [])

  return {
    running,
    result,
    setResult,
    loadingMore,
    transactionActive,
    transactionBusy,
    execute,
    executeExplain,
    handleLoadMore,
    beginTransaction,
    finishTransaction
  }
}
