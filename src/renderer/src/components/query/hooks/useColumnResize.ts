/**
 * 表格列宽拖拽调整 hook
 * 根据列名和数据内容自动计算最佳列宽，支持鼠标拖拽自定义列宽。
 */
import { useMemo, useRef, useState } from 'react'
import type { QueryExecutionResult } from '@/shared/connections'

/** useColumnResize 返回值接口 */
export interface UseColumnResizeReturn {
  customColumnWidths: Record<string, number>
  setCustomColumnWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>
  columnWidthMap: Map<string, number>
  handleColumnResizeStart: (e: React.MouseEvent, column: string) => void
}

/**
 * 表格列宽拖拽调整 hook
 * @param columns - 结果列名数组
 * @param rows - 结果行数据，用于采样计算列宽
 * @returns 自定义列宽状态、计算后的列宽 Map、拖拽开始处理函数
 */
export function useColumnResize(
  columns: QueryExecutionResult['columns'] | undefined,
  rows: QueryExecutionResult['rows'] | undefined
): UseColumnResizeReturn {
  const [customColumnWidths, setCustomColumnWidths] = useState<Record<string, number>>({})
  const resizerRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null)

  /**
   * 计算各列最佳宽度
   * 策略：取列名和前 50 行数据中最长字符串长度，乘以 9px 字符宽度 + 32px 内边距，
   * 限制在 130px ~ 400px 之间。用户手动拖拽过的列优先使用自定义宽度。
   */
  const columnWidthMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!columns) return map
    for (const col of columns) {
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
  }, [columns, rows, customColumnWidths])

  /** 列宽拖拽开始：记录初始状态，监听 mousemove/mouseup 事件 */
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

  return { customColumnWidths, setCustomColumnWidths, columnWidthMap, handleColumnResizeStart }
}
