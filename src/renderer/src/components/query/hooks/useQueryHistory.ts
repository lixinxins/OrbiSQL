/**
 * SQL 查询历史管理 hook
 * 支持 localStorage 持久化，最多保留 50 条记录。
 */
import { useEffect, useRef, useState } from 'react'
import { useGlobalCloseMenu } from '../../../hooks/useGlobalCloseMenu'
import { LS_KEYS } from '../../../utils/localStorage-keys'

/** SQL 历史条目接口 */
export interface SqlHistoryEntry {
  sql: string
  ts: number
  success: boolean
  queryCount?: number
}

export interface UseQueryHistoryReturn {
  sqlHistory: SqlHistoryEntry[]
  setSqlHistory: React.Dispatch<React.SetStateAction<SqlHistoryEntry[]>>
  showHistory: boolean
  setShowHistory: React.Dispatch<React.SetStateAction<boolean>>
  historyHostRef: React.RefObject<HTMLDivElement | null>
}

/**
 * SQL 查询历史管理 hook
 * @returns 历史列表、增删方法、下拉菜单显隐状态及容器 ref
 */
export function useQueryHistory(): UseQueryHistoryReturn {
  const [sqlHistory, setSqlHistory] = useState<SqlHistoryEntry[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEYS.SQL_HISTORY) ?? '[]') as SqlHistoryEntry[] } catch { return [] }
  })

  // 持久化 SQL 历史到 localStorage（纯副作用，与状态变更解耦）
  useEffect(() => {
    localStorage.setItem(LS_KEYS.SQL_HISTORY, JSON.stringify(sqlHistory))
  }, [sqlHistory])

  const [showHistory, setShowHistory] = useState(false)
  const historyHostRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭下拉菜单
  useGlobalCloseMenu(showHistory, () => { setShowHistory(false) })

  return { sqlHistory, setSqlHistory, showHistory, setShowHistory, historyHostRef }
}
