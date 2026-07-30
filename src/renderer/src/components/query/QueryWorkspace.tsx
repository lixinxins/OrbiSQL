/**
 * QueryWorkspace 主壳组件
 * 编排所有子组件和工具栏 JSX，管理全局状态并协调各 hooks 之间的数据流。
 * 从原始 1157 行单体文件拆分而来，当前仅负责状态编排和组件组合。
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowsInLineHorizontal, BookmarksSimple, CaretDown, ChartBar, Check, ClockCounterClockwise, Copy, FloppyDisk, Play, TextAlignLeft, Trash, WarningCircle } from '@phosphor-icons/react'
import type { DatabaseConnection } from '@/shared/connections'
import { useConfirmDialog } from '../ConfirmDialog'
import SaveQueryDialog from '../SaveQueryDialog'
import SearchableSelect from '../SearchableSelect'
import SqlEditor from '../SqlEditor'
import { usePanelResize } from './hooks/usePanelResize'
import { useColumnResize } from './hooks/useColumnResize'
import { useQueryHistory } from './hooks/useQueryHistory'
import { useSavedQueries } from './hooks/useSavedQueries'
import { useQueryExecution } from './hooks/useQueryExecution'
import { useCellEditing } from './hooks/useCellEditing'
import { useDatabaseOptions } from './hooks/useDatabaseOptions'
import { useSqlValidation } from './hooks/useSqlValidation'
import { useCompletionCandidates } from './hooks/useCompletionCandidates'
import { useSqlFormatter } from './hooks/useSqlFormatter'
import ResultPanel from './ResultPanel'
import ProcessListWorkspace from '../ProcessListWorkspace'

/** 查询上下文，描述当前标签页的初始连接、数据库和 SQL 等信息 */
export interface QueryContext {
  connectionId: number | null
  connectionName: string
  databaseName: string
  title?: string
  initialSql?: string
  autoRun?: boolean
  isProcessList?: boolean
}

/** QueryWorkspace 组件 Props */
interface QueryWorkspaceProps {
  sessionId: string
  active: boolean
  connections: DatabaseConnection[]
  context: QueryContext
  onDatabaseChange: (connectionId: number | null, databaseName: string) => void
  onSqlChange?: (sql: string) => void
}


/**
 * QueryWorkspace 主组件
 * 将各 hook 返回的状态注入到工具栏 JSX 和子组件中，自身不包含业务逻辑。
 */
function QueryWorkspace({ sessionId, active, connections, context, onDatabaseChange, onSqlChange }: QueryWorkspaceProps) {
  if (context.isProcessList && context.connectionId) {
    const conn = connections.find((c) => c.id === context.connectionId)
    return (
      <ProcessListWorkspace
        connectionId={context.connectionId}
        connectionName={context.connectionName || conn?.name || '数据库连接'}
        engine={conn?.engine}
        active={active}
      />
    )
  }

  const { confirm, confirmDialog } = useConfirmDialog()
  const editorRef = useRef<HTMLDivElement>(null)
  const initialDatabaseKey = context.connectionId ? `${context.connectionId}\u0000${context.databaseName}` : ''
  // databaseKey 用 \u0000 分隔 connectionId 和 databaseName，作为下拉框的唯一 value
  const [databaseKey, setDatabaseKey] = useState(initialDatabaseKey)
  const [sql, setSql] = useState(context.initialSql ?? '')
  const [selectedSql, setSelectedSql] = useState('')
  const [currentStatement, setCurrentStatement] = useState('')
  const [lastExecutedSql, setLastExecutedSql] = useState(context.initialSql ?? '')
  const onSqlChangeRef = useRef(onSqlChange)
  onSqlChangeRef.current = onSqlChange
  useEffect(() => { onSqlChangeRef.current?.(sql) }, [sql]) // P3: 同步 SQL 到父组件缓存
  const [formatError, setFormatError] = useState('')
  // 面板高度拖拽调整（编辑器 vs 结果面板）
  const workspaceRef = useRef<HTMLElement>(null)
  const { editorHeightPercent, handleResizeMouseDown } = usePanelResize(workspaceRef)
  // 结果面板 tab 状态：message / summary / result 三个顶层 tab
  const [resultPanelTab, setResultPanelTab] = useState<'message' | 'summary' | 'result'>('message')
  // 结果数据 tab 状态：data / chart / info 三个子 tab
  const [resultDataTab, setResultDataTab] = useState<'data' | 'chart' | 'info'>('data')
  const [resultPanelVisible, setResultPanelVisible] = useState(false)
  const [resultPanelCollapsed, setResultPanelCollapsed] = useState(false)
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const { sqlHistory, setSqlHistory, showHistory, setShowHistory, historyHostRef } = useQueryHistory()

  // 从连接列表派生数据库下拉选项（仅包含已连接的数据库）
  const databaseOptions = useDatabaseOptions(connections)

  const [connectionIdText, databaseName = ''] = databaseKey.split('\u0000')
  const connectionId = connectionIdText ? Number(connectionIdText) : null
  const selectedConnection = connections.find((connection) => connection.id === connectionId)
  const selectedDatabase = selectedConnection?.databases.find((database) => database.name === databaseName)

  const {
    running, result, setResult, loadingMore,
    execute, executeExplain, handleLoadMore
  } = useQueryExecution({
    sessionId, connectionId, databaseName,
    sql, engine: selectedConnection?.engine,
    autoRun: context.autoRun,
    setResultPanelVisible, setResultPanelTab, setResultDataTab,
    setResultPanelCollapsed, setSqlHistory, setFormatError
  })

  const {
    editingCell, setEditingCell, draftCellValue, setDraftCellValue,
    savingRow, rowSaveError, resultContextMenu, setResultContextMenu,
    errorCopied, editableColumnMap, primaryKeyColumns, nonPrimaryKeyColumns,
    startEditingCell, saveEditingCell, deleteResultRow, copyText, copyErrorMessage
  } = useCellEditing({
    result, setResult, connectionId, databaseName,
    confirm, setResultPanelTab
  })

  const validation = useSqlValidation(sql, selectedDatabase)

  const {
    savedQueries, showSavedQueries, setShowSavedQueries,
    showSaveQueryDialog, setShowSaveQueryDialog,
    saveQueryName, setSaveQueryName,
    savingQuery, saveQueryError, setSaveQueryError,
    saveQueryNotice, setSaveQueryNotice,
    savedQueriesHostRef, openSaveQueryDialog, saveQuery, deleteSavedQuery
  } = useSavedQueries({ connectionId, databaseName, sql, setSql, setResult, editorRef, confirm, active })

  const completionCandidates = useCompletionCandidates(selectedDatabase)
  const { formatSql, compressSql } = useSqlFormatter(sql, setSql, selectedConnection?.engine, editorRef, setFormatError)

  const { columnWidthMap, handleColumnResizeStart } = useColumnResize(result?.columns, result?.rows)
  const runnableSelection = selectedSql.trim()
  const runQuery = (sqlOverride?: string): void => {
    const sqlToExecute = sqlOverride?.trim() || sql.trim()
    if (!sqlToExecute) return
    setLastExecutedSql(sqlToExecute)
    void execute(sqlOverride)
  }

  const copySelectedSql = (): void => {
    if (!runnableSelection) return
    void navigator.clipboard.writeText(selectedSql)
  }

  return (
    <section className={`query-workspace${active ? ' active' : ''}`} ref={workspaceRef}>
      <div className="query-toolbar">
        {/* 运行按钮 */}
        <button
          type="button"
          className="run-query"
          onClick={() => runQuery(runnableSelection || currentStatement || undefined)}
          disabled={running || !sql.trim()}
          title={runnableSelection ? '仅运行选中的 SQL（Command/Ctrl + Enter）' : '运行光标所在 SQL（Command/Ctrl + Enter）'}
        ><Play weight="fill" />{running ? '运行中…' : runnableSelection ? '运行选中' : '运行当前'}</button>
        {/* 执行计划（EXPLAIN）按钮 */}
        <button type="button" className="format-query" onClick={() => void executeExplain()} disabled={running || !sql.trim()} title="一键分析执行计划 (EXPLAIN)"><ChartBar />执行计划</button>
        {/* 格式化 & 压缩 */}
        <button type="button" className="format-query" onClick={formatSql} disabled={!sql.trim()} title="格式化 SQL（Shift + Alt + F）"><TextAlignLeft />格式化</button>
        <button type="button" className="compress-query" onClick={compressSql} disabled={!sql.trim()} title="压缩 SQL（Shift + Alt + M）"><ArrowsInLineHorizontal />压缩</button>
        {/* SQL 执行历史下拉菜单 */}
        <div className="saved-query-menu-host" ref={historyHostRef}>
          <button type="button" className="saved-query-toggle" onMouseDown={() => setShowHistory((v) => !v)} onClick={(event) => event.stopPropagation()}>
            <ClockCounterClockwise />历史{sqlHistory.length ? ` ${sqlHistory.length}` : ''}<CaretDown />
          </button>
          {showHistory && (
            <div className="saved-query-menu" onMouseDown={(event) => event.stopPropagation()}>
              <header><strong>SQL 执行历史</strong><button type="button" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 11 }} onClick={() => setSqlHistory([])}><Trash />清空</button></header>
              <div className="saved-query-list">
                {sqlHistory.length === 0 && <div className="saved-query-empty"><ClockCounterClockwise /><span>还没有执行历史</span></div>}
                {sqlHistory.map((item: { sql: string; ts: number; success: boolean }) => (
                  <div className="saved-query-item history-query-item" key={item.ts}>
                    <button type="button" className="saved-query-load history-query-load" onClick={() => {
                      setSql(item.sql)
                      setShowHistory(false)
                      requestAnimationFrame(() => editorRef.current?.focus())
                    }}>
                      <span><strong className={`history-status ${item.success ? 'success' : 'error'}`}>{item.success ? '✓' : '✗'}</strong><small>{new Date(item.ts).toLocaleTimeString('zh-CN')}</small></span>
                      <code>{item.sql.replaceAll(/\s+/g, ' ').trim()}</code>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* 保存查询按钮（Cmd+S 快捷键由 useSavedQueries 管理） */}
        <button type="button" className="save-query-button" onClick={openSaveQueryDialog} disabled={!connectionId || !databaseName || !sql.trim()} title="保存查询（Command/Ctrl + S）"><FloppyDisk />保存查询</button>
        {/* 已保存查询列表下拉菜单 */}
        <div className="saved-query-menu-host" ref={savedQueriesHostRef}>
          <button type="button" className="saved-query-toggle" disabled={!connectionId || !databaseName} onMouseDown={() => setShowSavedQueries((current) => !current)} onClick={(event) => event.stopPropagation()}>
            <BookmarksSimple />已保存{savedQueries.length ? ` ${savedQueries.length}` : ''}<CaretDown />
          </button>
          {showSavedQueries && (
            <div className="saved-query-menu" onMouseDown={(event) => event.stopPropagation()}>
              <header><strong>已保存的查询</strong><span>{databaseName}</span></header>
              <div className="saved-query-list">
                {savedQueries.map((savedQuery) => (
                  <div className="saved-query-item" key={savedQuery.id}>
                    <button type="button" className="saved-query-load" title={savedQuery.sql} onClick={() => {
                      setSql(savedQuery.sql)
                      setResult(null)
                      setResultPanelVisible(false)
                      setFormatError('')
                      setSaveQueryNotice(`已载入：${savedQuery.name}`)
                      setShowSavedQueries(false)
                      requestAnimationFrame(() => editorRef.current?.focus())
                    }}>
                      <span><strong>{savedQuery.name}</strong><small>{new Date(savedQuery.updatedAt).toLocaleString('zh-CN')}</small></span>
                      <code>{savedQuery.sql.replaceAll(/\s+/g, ' ').trim()}</code>
                    </button>
                    <button type="button" className="delete-saved-query" title={`删除 ${savedQuery.name}`} aria-label={`删除查询 ${savedQuery.name}`} onClick={() => void deleteSavedQuery(savedQuery)}><Trash /></button>
                  </div>
                ))}
                {!savedQueries.length && <div className="saved-query-empty"><BookmarksSimple /><span>当前数据库还没有保存的查询</span></div>}
              </div>
            </div>
          )}
        </div>
        {saveQueryNotice && <span className="save-query-notice">{saveQueryNotice}</span>}
        <span className="query-database-label">当前数据库</span>
        <div className="query-database-select">
          <SearchableSelect
            value={databaseKey}
            options={databaseOptions}
            placeholder="请选择数据库"
            onChange={(value) => {
              setDatabaseKey(value)
              const [nextConnectionId, nextDatabaseName = ''] = value.split('\u0000')
              onDatabaseChange(nextConnectionId ? Number(nextConnectionId) : null, nextDatabaseName)
              setResult(null)
              setResultPanelVisible(false)
              setSaveQueryNotice('')
            }}
          />
        </div>
      </div>
      {/* 验证状态栏：显示格式错误或 SQL 字段校验结果 */}
      <div className={`query-validation${formatError || validation.messages.length ? ' error' : sql.trim() ? ' valid' : ''}`}>
        {formatError || validation.messages.length ? <WarningCircle /> : <Check />}
        <span className="query-validation-message">{formatError || (validation.messages.length ? validation.messages.join('；') : sql.trim() ? '字段检查通过' : '输入 SQL 后自动检查表和字段')}</span>
        {runnableSelection && (
          <span className="query-selection-actions">
            已选择 {selectedSql.length} 个字符
            <button type="button" onClick={copySelectedSql} title="复制选中的 SQL"><Copy />复制选中</button>
          </span>
        )}
      </div>
      {/* SQL 编辑器区域：高度随结果面板显隐动态调整 */}
      <div
        className={`sql-editor-shell${!resultPanelVisible || resultPanelCollapsed ? ' full-height' : ''}`}
        style={resultPanelVisible && !resultPanelCollapsed ? { height: `${editorHeightPercent}%` } : undefined}
      >
        <SqlEditor
          value={sql}
          onChange={(v) => { setSql(v); setFormatError('') }}
          onCursorChange={setCursorPosition}
          onSelectionChange={setSelectedSql}
          onCurrentStatementChange={setCurrentStatement}
          onRunQuery={runQuery}
          onSaveQuery={openSaveQueryDialog}
          onFormatSql={formatSql}
          onCompressSql={compressSql}
          completionItems={completionCandidates}
          errorPositions={Array.from(validation.errorStarts)}
          dialect={selectedConnection?.engine}
          placeholder="在此输入 SQL 语句…"
        />
      </div>
      {/* 查询结果面板 */}
      <ResultPanel
        result={result}
        databaseName={databaseName}
        sql={lastExecutedSql || sql}
        resultPanelTab={resultPanelTab}
        setResultPanelTab={setResultPanelTab}
        resultDataTab={resultDataTab}
        setResultDataTab={setResultDataTab}
        resultPanelVisible={resultPanelVisible}
        resultPanelCollapsed={resultPanelCollapsed}
        setResultPanelVisible={setResultPanelVisible}
        setResultPanelCollapsed={setResultPanelCollapsed}
        handleResizeMouseDown={handleResizeMouseDown}
        cursorPosition={cursorPosition}
        loadingMore={loadingMore}
        handleLoadMore={handleLoadMore}
        editingCell={editingCell}
        setEditingCell={setEditingCell}
        draftCellValue={draftCellValue}
        setDraftCellValue={setDraftCellValue}
        savingRow={savingRow}
        rowSaveError={rowSaveError}
        resultContextMenu={resultContextMenu}
        setResultContextMenu={setResultContextMenu}
        errorCopied={errorCopied}
        editableColumnMap={editableColumnMap}
        primaryKeyColumns={primaryKeyColumns}
        nonPrimaryKeyColumns={nonPrimaryKeyColumns}
        startEditingCell={startEditingCell}
        saveEditingCell={saveEditingCell}
        deleteResultRow={deleteResultRow}
        copyText={copyText}
        copyErrorMessage={copyErrorMessage}
        columnWidthMap={columnWidthMap}
        handleColumnResizeStart={handleColumnResizeStart}
      />
      {confirmDialog}
      {showSaveQueryDialog && (
        <SaveQueryDialog
          databaseName={databaseName}
          name={saveQueryName}
          saving={savingQuery}
          error={saveQueryError}
          onNameChange={(name) => { setSaveQueryName(name); setSaveQueryError('') }}
          onCancel={() => setShowSaveQueryDialog(false)}
          onSave={() => void saveQuery()}
        />
      )}
    </section>
  )
}

export default QueryWorkspace
