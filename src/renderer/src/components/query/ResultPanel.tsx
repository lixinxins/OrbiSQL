/**
 * 查询结果展示面板
 * 包含消息、摘要、结果数据三个 tab，支持虚拟化表格、列宽拖拽调整、右键菜单、行内编辑等。
 * 使用 React.memo 包裹以避免父组件状态变化导致不必要的大表格重渲染。
 */
import { memo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, CaretDown, CaretRight, CaretUp, ChartPie, Copy, Trash, X } from '@phosphor-icons/react'
import type { QueryExecutionResult, QueryEditableColumn } from '@/shared/connections'
import { formatDurationSeconds, formatDateTime, buildInsertSql, buildUpdateSql } from './utils/display-utils'
import CellRenderer from './CellRenderer'
import CellEditor from './CellEditor'
import QueryResultChart from '../QueryResultChart'

/** ResultPanel 组件 Props 接口，接收来自 QueryWorkspace 的所有状态和回调 */
interface ResultPanelProps {
  result: QueryExecutionResult | null
  databaseName: string
  sql: string
  resultPanelTab: 'message' | 'summary' | 'result'
  setResultPanelTab: React.Dispatch<React.SetStateAction<'message' | 'summary' | 'result'>>
  resultDataTab: 'data' | 'chart' | 'info'
  setResultDataTab: React.Dispatch<React.SetStateAction<'data' | 'chart' | 'info'>>
  resultPanelVisible: boolean
  resultPanelCollapsed: boolean
  setResultPanelVisible: (v: boolean) => void
  setResultPanelCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  handleResizeMouseDown: (e: React.MouseEvent) => void
  cursorPosition: { line: number; column: number }
  loadingMore: boolean
  handleLoadMore: () => Promise<void>
  // useCellEditing returns
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
  // useColumnResize returns
  columnWidthMap: Map<string, number>
  handleColumnResizeStart: (event: React.MouseEvent, column: string) => void
}

/**
 * ResultPanel 内部实现
 * 包含三个顶层 tab（消息/摘要/结果）和结果数据子 tab（数据/图表/信息）。
 */
function ResultPanelInner({
  result, databaseName, sql,
  resultPanelTab, setResultPanelTab,
  resultDataTab, setResultDataTab,
  resultPanelVisible, resultPanelCollapsed,
  setResultPanelVisible, setResultPanelCollapsed,
  handleResizeMouseDown, cursorPosition, loadingMore, handleLoadMore,
  editingCell, setEditingCell, draftCellValue, setDraftCellValue,
  savingRow, rowSaveError,
  resultContextMenu, setResultContextMenu,
  errorCopied, editableColumnMap, primaryKeyColumns, nonPrimaryKeyColumns,
  startEditingCell, saveEditingCell, deleteResultRow, copyText, copyErrorMessage,
  columnWidthMap, handleColumnResizeStart
}: ResultPanelProps) {
  const [onlyErrors, setOnlyErrors] = useState(false)

  // 结果网格虚拟化：使用 @tanstack/react-virtual 实现，每行估计高度 33px，overscan 10 行以减少快速滚动时的白屏
  const queryScrollRef = useRef<HTMLDivElement>(null)
  const queryVirtualizer = useVirtualizer({
    count: result?.rows?.length ?? 0,
    getScrollElement: () => queryScrollRef.current,
    estimateSize: () => 33,
    overscan: 10
  })

  return (
    <>
      {/* 拖拽调整手柄：仅在面板可见且未收起时显示 */}
      {resultPanelVisible && !resultPanelCollapsed && <div className="query-resize-handle" onMouseDown={handleResizeMouseDown}>
        <div className="query-resize-grip" />
      </div>}
      {resultPanelVisible && <section className={`query-results${resultPanelCollapsed ? ' collapsed' : ''}`}>
        <header className="query-result-tabs">
          <div className="query-result-tab-list" role="tablist">
            <button type="button" className={resultPanelTab === 'message' ? 'active' : ''} onClick={() => setResultPanelTab('message')}>消息</button>
            <button type="button" className={resultPanelTab === 'summary' ? 'active' : ''} onClick={() => setResultPanelTab('summary')}>摘要</button>
            {result?.success && result.columns && result.rows && (
              <button type="button" className={resultPanelTab === 'result' ? 'active' : ''} onClick={() => setResultPanelTab('result')}>结果 1</button>
            )}
          </div>
          <div className="query-result-panel-actions">
            <span className="query-cursor-badge" title="当前光标所在位置">
              Ln {cursorPosition.line}, Col {cursorPosition.column}
            </span>
            {result?.rows && (
              <span className="query-rows-badge" title="查询结果行数">
                {result.rows.length}{result.truncated ? '+' : ''} 行记录
              </span>
            )}
            <button type="button" title={resultPanelCollapsed ? '展开结果区域' : '收起结果区域'} onClick={() => setResultPanelCollapsed((current) => !current)}>
              {resultPanelCollapsed ? <CaretUp /> : <CaretDown />}
            </button>
            <button type="button" title="关闭结果面板" onClick={() => { setResultPanelVisible(false); setResultContextMenu(null) }}><X /></button>
          </div>
        </header>

        {!resultPanelCollapsed && <div className="query-result-body">
          {resultPanelTab === 'message' && (
            <div className="query-result-message-view">
              {result ? <>
                <code>{sql.trim()}</code>
                <p className={rowSaveError || !result.success ? 'error' : 'success'}>&gt; {rowSaveError || result.message}</p>
                <p>&gt; 查询时间：{formatDurationSeconds(result.durationMs)}</p>
                {(rowSaveError || !result.success) && (
                  <button type="button" className="query-error-copy-btn" onClick={() => void copyErrorMessage()}><Copy />{errorCopied ? '已复制' : '复制错误信息'}</button>
                )}
              </> : <p className="empty">等待执行查询</p>}
            </div>
          )}

          {resultPanelTab === 'summary' && (
            <div className="query-result-summary-view">
              <div className="query-result-summary-metrics">
                <dl><dt>已处理的查询</dt><dd>{result?.queryCount ?? 0}</dd></dl>
                <dl><dt>开始时间</dt><dd>{formatDateTime(result?.startTime)}</dd></dl>
                <dl><dt>成功</dt><dd>{result?.successCount ?? (result?.success ? 1 : 0)}</dd></dl>
                <dl><dt>结束时间</dt><dd>{formatDateTime(result?.endTime)}</dd></dl>
                <dl><dt>错误</dt><dd>{result?.errorCount ?? (result && !result.success ? 1 : 0)}</dd></dl>
                <dl><dt>运行时间</dt><dd>{formatDurationSeconds(result?.durationMs)}</dd></dl>
              </div>
              <label className="query-result-only-errors">
                <input type="checkbox" checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} />
                <span>仅显示错误</span>
              </label>
              <div className="query-result-summary-table-wrap">
                <table className="query-result-summary-table">
                  <thead><tr><th>查询</th><th>消息</th><th>查询时间</th><th>获取时间</th></tr></thead>
                  <tbody>
                    {result ? (result.statementResults ?? [{ index: 1, sql, success: result.success, message: rowSaveError || result.message, durationMs: result.durationMs ?? 0 }])
                      .filter((item) => !onlyErrors || !item.success)
                      .map((item) => <tr key={item.index} className={item.success ? '' : 'error'}>
                        <td title={item.sql}><strong>#{item.index}</strong> {item.sql.trim()}</td>
                        <td title={item.message}>{item.message}</td>
                        <td>{formatDurationSeconds(item.durationMs)}</td>
                        <td>0.000000s</td>
                      </tr>) : <tr><td className="empty" colSpan={4}>{onlyErrors ? '没有错误查询' : '暂无查询记录'}</td></tr>}
                    {onlyErrors && result && (result.statementResults ?? [{ success: result.success }]).every((item) => item.success) && <tr><td className="empty" colSpan={4}>没有错误查询</td></tr>}
                  </tbody>
                </table>
              </div>
              {result?.statementResults && result.statementResults.length > 1 && <div className="query-batch-result-list">
                {result.statementResults.map((item) => <details key={item.index} open={!item.success}>
                  <summary><span className={item.success ? 'success' : 'error'}>{item.success ? '成功' : '失败'}</span><strong>语句 {item.index}</strong><code>{item.sql.replaceAll(/\s+/g, ' ').trim()}</code><small>{formatDurationSeconds(item.durationMs)}</small></summary>
                  <div><p>{item.message}</p>{item.rows && item.columns && <div className="query-batch-preview"><table><thead><tr>{item.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{item.rows.slice(0, 20).map((row, rowIndex) => <tr key={rowIndex}>{item.columns!.map((column) => <td key={column}><CellRenderer value={row[column]} /></td>)}</tr>)}</tbody></table>{item.rows.length > 20 && <span>仅预览前 20 行，共 {item.rows.length} 行</span>}</div>}</div>
                </details>)}
              </div>}
            </div>
          )}

          {resultPanelTab === 'result' && result?.success && result.columns && result.rows && (
            <div className="query-result-data-view">
              {/* 数据视图子 tab 工具栏：数据 / 图表 / 信息 */}
              <div className="query-result-data-toolbar">
                <div>
                  <button type="button" className={resultDataTab === 'data' ? 'active' : ''} onClick={() => setResultDataTab('data')}>数据</button>
                  <button type="button" className={resultDataTab === 'chart' ? 'active' : ''} onClick={() => setResultDataTab('chart')}><ChartPie />图表</button>
                  <button type="button" className={resultDataTab === 'info' ? 'active' : ''} onClick={() => setResultDataTab('info')}>信息</button>
                </div>
                {result.editable
                  ? <span className="query-editable-badge">可编辑 · {result.editable.tableName}</span>
                  : <span className="query-result-readonly">只读结果</span>}
              </div>
              {/* 数据 tab：虚拟化表格，支持列宽拖拽、行内编辑、右键菜单 */}
              {resultDataTab === 'data' ? <div className="query-table-wrap virtual-scroll" ref={queryScrollRef}>
                <table className="query-table">
                  <thead><tr>{result.columns.map((column) => {
                    const width = columnWidthMap.get(column) ?? 150
                    return (
                      <th key={column} className="th-resizable" style={{ width: `${width}px`, minWidth: `${width}px` }}>
                        <span>{column}</span>
                        <div
                          className="th-resizer"
                          title="拖动调整列宽"
                          onMouseDown={(event) => handleColumnResizeStart(event, column)}
                        />
                      </th>
                    )
                  })}</tr></thead>
                  <tbody className="virtual-tbody" style={{ height: `${queryVirtualizer.getTotalSize()}px` }}>
                    {queryVirtualizer.getVirtualItems().map((virtualRow) => {
                      const row = result.rows![virtualRow.index]
                      return <tr key={virtualRow.index} style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}>
                        {result.columns!.map((column) => {
                          const width = columnWidthMap.get(column) ?? 150
                          const editableColumn = editableColumnMap.get(column)
                          const isEditing = editingCell?.rowIndex === virtualRow.index && editingCell.column === column
                          const cellWidth = isEditing ? Math.max(width, 310) : width
                          return <td
                            key={column}
                            className={`${editableColumn ? 'editable-cell' : ''}${isEditing ? ' editing-cell' : ''}`}
                            style={{ width: `${cellWidth}px`, minWidth: `${cellWidth}px` }}
                            onClick={() => editableColumn && !isEditing && startEditingCell(virtualRow.index, column)}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              setResultContextMenu({ x: Math.min(event.clientX, window.innerWidth - 196), y: Math.min(event.clientY, window.innerHeight - 190), rowIndex: virtualRow.index, column })
                            }}
                          >
                            {isEditing && editableColumn
                              ? <CellEditor
                                  draftCellValue={draftCellValue}
                                  savingRow={savingRow}
                                  onDraftChange={setDraftCellValue}
                                  onSave={saveEditingCell}
                                  onCancel={() => setEditingCell(null)}
                                  onNull={() => setDraftCellValue(null)}
                                  onEmpty={() => setDraftCellValue('')}
                                />
                              : <CellRenderer value={row[column]} />}
                          </td>
                        })}
                      </tr>
                    })}
                  </tbody>
                </table>
                {/* 加载更多按钮：当结果被截断且有游标时显示 */}
                {result.truncated && result.cursorId && (
                  <div className="query-load-more-bar">
                    <button type="button" className="query-load-more-btn" disabled={loadingMore} onClick={() => void handleLoadMore()}>
                      {loadingMore ? '加载中...' : `加载更多${result.totalRows ? ` (已加载 ${result.rows.length} / ${result.totalRows})` : ` (已加载 ${result.rows.length} 行)`}`}
                      {!loadingMore && <ArrowDown />}
                    </button>
                  </div>
                )}
              </div> : resultDataTab === 'chart' ? <QueryResultChart columns={result.columns} rows={result.rows} /> : <div className="query-result-info">
                {/* 信息 tab：显示记录数、字段数、运行时间等元数据 */}
                <dl><dt>返回记录</dt><dd>{result.rows.length}</dd></dl>
                <dl><dt>字段数量</dt><dd>{result.columns.length}</dd></dl>
                <dl><dt>运行时间</dt><dd>{formatDurationSeconds(result.durationMs)}</dd></dl>
                <dl><dt>编辑状态</dt><dd>{result.editable ? `可编辑（${result.editable.tableName}）` : '只读'}</dd></dl>
              </div>}
            </div>
          )}
        </div>}
      </section>}
      {/* 右键菜单：支持删除记录、复制字段名、复制为 INSERT/UPDATE 语句 */}
      {resultContextMenu && result?.rows?.[resultContextMenu.rowIndex] && (
        <div
          className="connection-context-menu query-result-context-menu"
          style={{ left: resultContextMenu.x, top: resultContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="danger" disabled={!result.editable} onClick={() => void deleteResultRow(resultContextMenu.rowIndex)}>
            <Trash />删除记录
          </button>
          <button type="button" disabled={!resultContextMenu.column} onClick={() => void copyText(resultContextMenu.column, '字段名称已复制')}>
            <Copy />复制字段名称
          </button>
          <span className="context-menu-divider" />
          <div className="context-submenu-host">
            <button type="button" disabled={!result.editable}><Copy /><span className="context-menu-label">复制为</span><CaretRight className="context-submenu-caret" /></button>
            {result.editable && <div className={`connection-context-menu context-submenu${resultContextMenu.x > window.innerWidth - 390 ? ' left' : ''}`}>
              <button type="button" onClick={() => void copyText(result.editable && result.rows ? buildInsertSql(databaseName, result.editable.tableName, result.editable.columns, result.rows[resultContextMenu.rowIndex]) : '', '新增语句已复制')}><Copy />复制为新增语句</button>
              <button type="button" onClick={() => void copyText(result.editable && result.rows ? buildUpdateSql(databaseName, result.editable.tableName, nonPrimaryKeyColumns, primaryKeyColumns, result.rows[resultContextMenu.rowIndex]) : '', '修改语句已复制')}><Copy />复制为修改语句</button>
              <button type="button" disabled={!resultContextMenu.column} onClick={() => void copyText(resultContextMenu.column, '字段名称已复制')}><Copy />复制字段名称</button>
            </div>}
          </div>
        </div>
      )}
    </>
  )
}

// 使用 React.memo 包裹，避免父组件其他状态变化触发结果面板重渲染（表格可能很大）
const ResultPanel = memo(ResultPanelInner)
export default ResultPanel
