import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { ArrowsInLineHorizontal, BookmarksSimple, CaretDown, CaretRight, CaretUp, ChartBar, ChartPie, Check, ClockCounterClockwise, Code, Copy, FloppyDisk, Lightning, Play, TextAlignLeft, Trash, WarningCircle, X } from '@phosphor-icons/react'
import { format as formatSqlText } from 'sql-formatter'
import type { DatabaseConnection, DatabaseItem, QueryExecutionResult, SavedQuery } from '../../../shared/connections'
import { useConfirmDialog } from './ConfirmDialog'
import SaveQueryDialog from './SaveQueryDialog'
import SearchableSelect from './SearchableSelect'
import QueryResultChart from './QueryResultChart'

export interface QueryContext {
  connectionId: number | null
  connectionName: string
  databaseName: string
  title?: string
  initialSql?: string
  autoRun?: boolean
}

interface QueryWorkspaceProps {
  sessionId: string
  active: boolean
  connections: DatabaseConnection[]
  context: QueryContext
  onDatabaseChange: (connectionId: number | null, databaseName: string) => void
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'DATABASE', 'VIEW', 'INDEX', 'JOIN', 'LEFT JOIN',
  'RIGHT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL', 'LIKE', 'IN',
  'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX'
]

const SQL_KEYWORD_SET = new Set(SQL_KEYWORDS.flatMap((keyword) => keyword.split(' ')))
const SQL_FUNCTIONS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NOW', 'COALESCE', 'IFNULL', 'CONCAT', 'DATE_FORMAT', 'ROUND'])

interface SqlToken {
  value: string
  start: number
  kind: 'space' | 'comment' | 'string' | 'number' | 'word' | 'symbol'
}

interface SqlValidation {
  tokens: SqlToken[]
  errorStarts: Set<number>
  messages: string[]
}

const tokenizeSql = (sql: string): SqlToken[] => {
  const tokens: SqlToken[] = []
  let index = 0
  while (index < sql.length) {
    const start = index
    const character = sql[index]
    if (/\s/.test(character)) {
      while (index < sql.length && /\s/.test(sql[index])) index += 1
      tokens.push({ value: sql.slice(start, index), start, kind: 'space' })
    } else if (sql.startsWith('--', index) || character === '#') {
      index = sql.indexOf('\n', index)
      if (index < 0) index = sql.length
      tokens.push({ value: sql.slice(start, index), start, kind: 'comment' })
    } else if (sql.startsWith('/*', index)) {
      const end = sql.indexOf('*/', index + 2)
      index = end < 0 ? sql.length : end + 2
      tokens.push({ value: sql.slice(start, index), start, kind: 'comment' })
    } else if (character === "'" || character === '"' || character === '`') {
      const quote = character
      index += 1
      while (index < sql.length) {
        if (sql[index] === '\\') index += 2
        else if (sql[index] === quote) { index += 1; break }
        else index += 1
      }
      tokens.push({ value: sql.slice(start, index), start, kind: quote === '`' ? 'word' : 'string' })
    } else if (/\d/.test(character)) {
      while (index < sql.length && /[\d.]/.test(sql[index])) index += 1
      tokens.push({ value: sql.slice(start, index), start, kind: 'number' })
    } else if (/[A-Za-z_$\u4e00-\u9fff]/.test(character)) {
      while (index < sql.length && /[A-Za-z0-9_$\u4e00-\u9fff]/.test(sql[index])) index += 1
      tokens.push({ value: sql.slice(start, index), start, kind: 'word' })
    } else {
      index += 1
      tokens.push({ value: character, start, kind: 'symbol' })
    }
  }
  return tokens
}

const identifierValue = (token: SqlToken): string => token.value.replace(/^`|`$/g, '')

const compressSqlText = (sql: string): string => {
  const tokens = tokenizeSql(sql).filter((token) => token.kind !== 'space')
  const isWordLike = (token: SqlToken): boolean => ['word', 'number', 'string'].includes(token.kind)
  const renderToken = (token: SqlToken): string => {
    if (token.kind !== 'comment') return token.value
    const singleLineComment = token.value.startsWith('--') || token.value.startsWith('#')
    const content = singleLineComment
      ? token.value.replace(/^(--|#)\s*/, '')
      : token.value.replace(/^\/\*|\*\/$/g, '')
    return `/* ${content.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim()} */`
  }

  let output = ''
  let previous: SqlToken | undefined
  tokens.forEach((token) => {
    const hadWhitespace = previous
      ? previous.start + previous.value.length < token.start
      : false
    const needsSpace = previous && (
      (isWordLike(previous) && isWordLike(token))
      || previous.kind === 'comment'
      || token.kind === 'comment'
      || (previous.value === ')' && token.kind === 'word')
      || (previous.kind === 'symbol' && token.kind === 'symbol' && hadWhitespace)
    )
    if (needsSpace && output && !output.endsWith(' ')) output += ' '
    output += renderToken(token)
    previous = token
  })
  return output.trim()
}

const validateSql = (sql: string, database?: DatabaseItem): SqlValidation => {
  const tokens = tokenizeSql(sql)
  const errorStarts = new Set<number>()
  const messages = new Set<string>()
  if (!database || !sql.trim()) return { tokens, errorStarts, messages: [] }

  const significant = tokens.filter((token) => token.kind !== 'space' && token.kind !== 'comment')
  const aliases = new Map<string, DatabaseItem['tables'][number]>()
  const sourceTables: DatabaseItem['tables'] = []
  const tableTokenIndexes = new Set<number>()
  for (let index = 0; index < significant.length; index += 1) {
    const keyword = significant[index].value.toUpperCase()
    if (!['FROM', 'JOIN', 'UPDATE', 'INTO'].includes(keyword)) continue
    let tableIndex = index + 1
    if (significant[tableIndex + 1]?.value === '.') tableIndex += 2
    const tableToken = significant[tableIndex]
    if (!tableToken || tableToken.kind !== 'word') continue
    tableTokenIndexes.add(tableIndex)
    const tableName = identifierValue(tableToken)
    const table = database.tables.find((item) => item.name.toLowerCase() === tableName.toLowerCase())
    if (!table) {
      errorStarts.add(tableToken.start)
      messages.add(`数据表“${tableName}”不存在`)
      continue
    }
    sourceTables.push(table)
    aliases.set(table.name.toLowerCase(), table)
    let aliasIndex = tableIndex + 1
    if (significant[aliasIndex]?.value.toUpperCase() === 'AS') aliasIndex += 1
    const aliasToken = significant[aliasIndex]
    if (aliasToken?.kind === 'word' && !SQL_KEYWORD_SET.has(aliasToken.value.toUpperCase())) {
      aliases.set(identifierValue(aliasToken).toLowerCase(), table)
      tableTokenIndexes.add(aliasIndex)
    }
  }

  for (let index = 0; index < significant.length - 2; index += 1) {
    const ownerToken = significant[index]
    const dot = significant[index + 1]
    const columnToken = significant[index + 2]
    if (ownerToken.kind !== 'word' || dot.value !== '.' || columnToken.kind !== 'word') continue
    const table = aliases.get(identifierValue(ownerToken).toLowerCase())
    if (!table) continue
    const columnName = identifierValue(columnToken)
    if (columnName !== '*' && !table.columns.some((column) => column.toLowerCase() === columnName.toLowerCase())) {
      errorStarts.add(columnToken.start)
      messages.add(`字段“${columnName}”不在表“${table.name}”中`)
    }
  }

  const uniqueTables = Array.from(new Set(sourceTables))
  if (uniqueTables.length === 1) {
    const table = uniqueTables[0]
    const selectIndex = significant.findIndex((token) => token.value.toUpperCase() === 'SELECT')
    const fromIndex = significant.findIndex((token, index) => index > selectIndex && token.value.toUpperCase() === 'FROM')
    if (selectIndex >= 0 && fromIndex > selectIndex) {
      for (let index = selectIndex + 1; index < fromIndex; index += 1) {
        const token = significant[index]
        if (token.kind !== 'word' || tableTokenIndexes.has(index)) continue
        const value = identifierValue(token)
        const upper = value.toUpperCase()
        const previous = significant[index - 1]?.value.toUpperCase()
        const next = significant[index + 1]?.value
        if (SQL_KEYWORD_SET.has(upper) || SQL_FUNCTIONS.has(upper) || previous === 'AS' || next === '(' || significant[index - 1]?.value === '.' || next === '.') continue
        if (!table.columns.some((column) => column.toLowerCase() === value.toLowerCase())) {
          errorStarts.add(token.start)
          messages.add(`字段“${value}”不在表“${table.name}”中`)
        }
      }
    }
  }
  return { tokens, errorStarts, messages: Array.from(messages) }
}

function QueryWorkspace({ sessionId, active, connections, context, onDatabaseChange }: QueryWorkspaceProps) {
  const { confirm, confirmDialog } = useConfirmDialog()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const autoRunStarted = useRef(false)
  const initialDatabaseKey = context.connectionId ? `${context.connectionId}\u0000${context.databaseName}` : ''
  const [databaseKey, setDatabaseKey] = useState(initialDatabaseKey)
  const [sql, setSql] = useState(context.initialSql ?? '')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<QueryExecutionResult | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const [suggestionPosition, setSuggestionPosition] = useState({ left: 20, top: 18 })
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; column: string } | null>(null)
  const [draftCellValue, setDraftCellValue] = useState<unknown>('')
  const [savingRow, setSavingRow] = useState(false)
  const [rowSaveError, setRowSaveError] = useState('')
  const [formatError, setFormatError] = useState('')
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([])
  const [showSavedQueries, setShowSavedQueries] = useState(false)
  const [showSaveQueryDialog, setShowSaveQueryDialog] = useState(false)
  const [saveQueryName, setSaveQueryName] = useState('')
  const [savingQuery, setSavingQuery] = useState(false)
  const [saveQueryError, setSaveQueryError] = useState('')
  const [saveQueryNotice, setSaveQueryNotice] = useState('')
  const [resultContextMenu, setResultContextMenu] = useState<{ x: number; y: number; rowIndex: number; column: string } | null>(null)
  const [editorHeightPercent, setEditorHeightPercent] = useState(38)
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const [errorCopied, setErrorCopied] = useState(false)
  const [resultPanelTab, setResultPanelTab] = useState<'message' | 'summary' | 'result'>('message')
  const [resultDataTab, setResultDataTab] = useState<'data' | 'chart' | 'info'>('data')
  const [resultPanelVisible, setResultPanelVisible] = useState(false)
  const [resultPanelCollapsed, setResultPanelCollapsed] = useState(false)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [sqlHistory, setSqlHistory] = useState<{ sql: string; ts: number; success: boolean }[]>(() => {
    try { return JSON.parse(localStorage.getItem('orbisql.sql-history.v1') ?? '[]') as { sql: string; ts: number; success: boolean }[] } catch { return [] }
  })
  const [showHistory, setShowHistory] = useState(false)
  const [transactionActive, setTransactionActive] = useState(false)
  const [transactionBusy, setTransactionBusy] = useState(false)
  const transactionActiveRef = useRef(false)

  useEffect(() => () => {
    if (transactionActiveRef.current) void window.omnidb.queries.rollbackTransaction(sessionId)
  }, [sessionId])

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

  const databaseOptions = useMemo(() => connections
    .filter((connection) => connection.open && connection.connected)
    .flatMap((connection) => connection.databases.map((database) => ({
      value: `${connection.id}\u0000${database.name}`,
      label: `${connection.name} / ${database.name}`,
      keywords: `${connection.engine} ${database.name}`
    }))), [connections])

  const [connectionIdText, databaseName = ''] = databaseKey.split('\u0000')
  const connectionId = connectionIdText ? Number(connectionIdText) : null
  const selectedConnection = connections.find((connection) => connection.id === connectionId)
  const selectedDatabase = selectedConnection?.databases.find((database) => database.name === databaseName)
  const validation = useMemo(() => validateSql(sql, selectedDatabase), [selectedDatabase, sql])

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

  useEffect(() => {
    if (!showSavedQueries) return
    const close = (): void => setShowSavedQueries(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [showSavedQueries])

  const completionCandidates = useMemo(() => {
    const tableNames = selectedDatabase?.tables.map((table) => table.name) ?? []
    const columnNames = selectedDatabase?.tables.flatMap((table) => table.columns) ?? []
    return Array.from(new Set([...SQL_KEYWORDS, ...tableNames, ...columnNames]))
  }, [selectedDatabase])

  const updateSuggestions = (value: string, cursor: number, target: HTMLTextAreaElement): void => {
    const beforeCursor = value.slice(0, cursor)
    const token = beforeCursor.match(/[A-Za-z0-9_]+$/)?.[0] ?? ''
    if (!token) {
      setSuggestions([])
      return
    }
    const matches = completionCandidates
      .filter((candidate) => candidate.toLowerCase().startsWith(token.toLowerCase()) && candidate.toLowerCase() !== token.toLowerCase())
      .slice(0, 8)
    setSuggestions(matches)
    setSuggestionIndex(0)

    const lines = beforeCursor.split('\n')
    const line = lines.length - 1
    const column = lines[lines.length - 1].length
    setSuggestionPosition({
      left: Math.max(14, Math.min(target.clientWidth - 230, 20 + column * 7.2 - target.scrollLeft)),
      top: Math.max(10, 18 + (line + 1) * 20.4 - target.scrollTop)
    })
  }

  const changeSql = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setSql(event.target.value)
    setFormatError('')
    updateSuggestions(event.target.value, event.target.selectionStart, event.target)
    updateCursorPosition(event.target)
  }

  const updateCursorPosition = (target: HTMLTextAreaElement): void => {
    const beforeCursor = target.value.slice(0, target.selectionStart)
    const lines = beforeCursor.split('\n')
    setCursorPosition({ line: lines.length, column: lines[lines.length - 1].length + 1 })
  }

  const applySuggestion = (suggestion: string): void => {
    const textarea = textareaRef.current
    if (!textarea) return
    const cursor = textarea.selectionStart
    const beforeCursor = sql.slice(0, cursor)
    const tokenLength = beforeCursor.match(/[A-Za-z0-9_]+$/)?.[0].length ?? 0
    const nextSql = `${sql.slice(0, cursor - tokenLength)}${suggestion}${sql.slice(cursor)}`
    const nextCursor = cursor - tokenLength + suggestion.length
    setSql(nextSql)
    setSuggestions([])
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const formatSql = (): void => {
    if (!sql.trim()) return
    try {
      const formatted = formatSqlText(sql, {
        language: selectedConnection?.engine === 'PostgreSQL'
          ? 'postgresql'
          : selectedConnection?.engine === 'SQLite' ? 'sqlite' : 'mysql',
        keywordCase: 'upper',
        tabWidth: 2,
        linesBetweenQueries: 1
      })
      setSql(formatted)
      setSuggestions([])
      setFormatError('')
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (error) {
      setFormatError(`SQL 格式化失败：${error instanceof Error ? error.message : '语句格式不正确'}`)
    }
  }

  const compressSql = (): void => {
    if (!sql.trim()) return
    try {
      setSql(compressSqlText(sql))
      setSuggestions([])
      setFormatError('')
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (error) {
      setFormatError(`SQL 压缩失败：${error instanceof Error ? error.message : '语句格式不正确'}`)
    }
  }

  const openSaveQueryDialog = (): void => {
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
  }

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

  const deleteSavedQuery = async (savedQuery: SavedQuery): Promise<void> => {
    if (!connectionId || !databaseName) return
    setShowSavedQueries(false)
    const confirmed = await confirm({
      title: '删除已保存的查询',
      message: `确定要删除查询“${savedQuery.name}”吗？`,
      detail: '只会删除 OrbiSQL 本地保存的查询记录，不会影响数据库中的任何数据。',
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
  }, [active, connectionId, databaseName, showSaveQueryDialog, sql])

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      event.stopPropagation()
      openSaveQueryDialog()
      return
    }
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      formatSql()
      return
    }
    if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'm') {
      event.preventDefault()
      compressSql()
      return
    }
    if (!suggestions.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSuggestionIndex((current) => (current + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault()
      applySuggestion(suggestions[suggestionIndex])
    } else if (event.key === 'Escape') {
      setSuggestions([])
    }
  }

  // 拖拽调整编辑器与结果面板的高度
  const handleResizeMouseDown = (event: React.MouseEvent): void => {
    event.preventDefault()
    dragState.current = { startY: event.clientY, startHeight: editorHeightPercent }
    document.addEventListener('mousemove', handleResizeMouseMove)
    document.addEventListener('mouseup', handleResizeMouseUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const handleResizeMouseMove = (event: MouseEvent): void => {
    if (!dragState.current || !workspaceRef.current) return
    const deltaY = event.clientY - dragState.current.startY
    const workspaceHeight = workspaceRef.current.getBoundingClientRect().height
    const percentDelta = (deltaY / workspaceHeight) * 100
    const newPercent = Math.max(15, Math.min(85, dragState.current.startHeight + percentDelta))
    setEditorHeightPercent(newPercent)
  }

  const handleResizeMouseUp = (): void => {
    dragState.current = null
    document.removeEventListener('mousemove', handleResizeMouseMove)
    document.removeEventListener('mouseup', handleResizeMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  const execute = async (): Promise<void> => {
    if (!connectionId || !databaseName) {
      setResult({ success: false, message: '请先选择数据库' })
      setResultPanelVisible(true)
      setResultPanelTab('message')
      setResultPanelCollapsed(false)
      return
    }
    setRunning(true)
    setEditingCell(null)
    setRowSaveError('')
    setSuggestions([])
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
        const next = [entry, ...prev.filter((h) => h.sql !== sql.trim())].slice(0, 50)
        localStorage.setItem('orbisql.sql-history.v1', JSON.stringify(next))
        return next
      })
    } finally {
      setRunning(false)
    }
  }

  const beginTransaction = async (): Promise<void> => {
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
  }

  const finishTransaction = async (commit: boolean): Promise<void> => {
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
  }

  useEffect(() => {
    if (!context.autoRun || autoRunStarted.current) return
    autoRunStarted.current = true
    void execute()
  }, [])

  const startEditingCell = (rowIndex: number, column: string): void => {
    if (!result?.rows?.[rowIndex] || !result.editable?.columns.some((item) => item.resultName === column) || savingRow) return
    setEditingCell({ rowIndex, column })
    setDraftCellValue(result.rows[rowIndex][column])
    setRowSaveError('')
  }

  const saveEditingCell = async (): Promise<void> => {
    if (!editingCell || !result?.rows?.[editingCell.rowIndex] || !result.editable || !connectionId) return
    const activeCell = editingCell
    const originalRow = result.rows[activeCell.rowIndex]
    const editableColumn = result.editable.columns.find((column) => column.resultName === activeCell.column)
    if (!editableColumn) return
    const primaryKeyValues: Record<string, unknown> = {}
    result.editable.columns.forEach((column) => {
      if (column.primaryKey) primaryKeyValues[column.sourceName] = originalRow[column.resultName]
    })
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

  const copyErrorMessage = async (): Promise<void> => {
    const text = rowSaveError || result?.message || ''
    try {
      await navigator.clipboard.writeText(text)
      setErrorCopied(true)
      setTimeout(() => setErrorCopied(false), 2000)
    } catch {
      return
    }
  }

  const formatDateTime = (iso?: string): string => {
    if (!iso) return '--'
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }).replaceAll('/', '-')
    } catch {
      return '--'
    }
  }

  const formatDurationSeconds = (ms?: number): string => `${((ms ?? 0) / 1000).toFixed(6)}s`

  const buildInsertSql = (rowIndex: number): string => {
    if (!result?.editable || !result.rows?.[rowIndex]) return ''
    const row = result.rows[rowIndex]
    const columns = result.editable.columns
    return `INSERT INTO ${sqlIdentifier(databaseName)}.${sqlIdentifier(result.editable.tableName)} (${columns.map((column) => sqlIdentifier(column.sourceName)).join(', ')}) VALUES (${columns.map((column) => sqlValue(row[column.resultName])).join(', ')});`
  }

  const buildUpdateSql = (rowIndex: number): string => {
    if (!result?.editable || !result.rows?.[rowIndex]) return ''
    const row = result.rows[rowIndex]
    const changedColumns = result.editable.columns.filter((column) => !column.primaryKey)
    const primaryKeys = result.editable.columns.filter((column) => column.primaryKey)
    return `UPDATE ${sqlIdentifier(databaseName)}.${sqlIdentifier(result.editable.tableName)} SET ${changedColumns.map((column) => `${sqlIdentifier(column.sourceName)} = ${sqlValue(row[column.resultName])}`).join(', ')} WHERE ${primaryKeys.map((column) => `${sqlIdentifier(column.sourceName)} <=> ${sqlValue(row[column.resultName])}`).join(' AND ')};`
  }

  const deleteResultRow = async (rowIndex: number): Promise<void> => {
    if (!result?.editable || !result.rows?.[rowIndex] || !connectionId) return
    setResultContextMenu(null)
    const confirmed = await confirm({
      title: '删除数据记录',
      message: `确定要删除表“${result.editable.tableName}”中的这条记录吗？`,
      detail: '该记录会从数据库中永久删除，此操作无法撤销。',
      confirmLabel: '删除记录'
    })
    if (!confirmed) return
    const row = result.rows[rowIndex]
    const primaryKeyValues: Record<string, unknown> = {}
    result.editable.columns.forEach((column) => {
      if (column.primaryKey) primaryKeyValues[column.sourceName] = row[column.resultName]
    })
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
  }

  const [showSnippets, setShowSnippets] = useState(false)

  const executeExplain = async (): Promise<void> => {
    if (!connectionId || !databaseName || !sql.trim() || running) return
    const isPg = selectedConnection?.engine === 'PostgreSQL'
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
  }

  const PRESET_SNIPPETS = [
    { name: 'SELECT 基础查询模板', sql: 'SELECT * FROM table_name LIMIT 100;' },
    { name: 'COUNT 统计聚合模板', sql: 'SELECT status, COUNT(*) AS total FROM table_name GROUP BY status HAVING COUNT(*) > 0;' },
    { name: 'INNER JOIN 关联查询模板', sql: 'SELECT a.*, b.* FROM table1 a\nINNER JOIN table2 b ON a.id = b.table1_id\nWHERE a.status = 1;' },
    { name: 'CREATE TABLE 建表 DDL 模板', sql: 'CREATE TABLE example (\n  id BIGINT PRIMARY KEY AUTO_INCREMENT,\n  name VARCHAR(255) NOT NULL,\n  status TINYINT NOT NULL DEFAULT 0,\n  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;' },
    { name: 'CREATE INDEX 创建索引模板', sql: 'CREATE INDEX idx_status_created ON table_name (status, created_at);' }
  ]

  const displayValue = (value: unknown): string => {
    if (value === null) return 'NULL'
    if (value instanceof Uint8Array) return `[二进制 ${value.byteLength} 字节]`
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  return (
    <section className={`query-workspace${active ? ' active' : ''}`} ref={workspaceRef}>
      <div className="query-toolbar">
        <button type="button" className="run-query" onClick={() => void execute()} disabled={running || !sql.trim()}><Play weight="fill" />{running ? '运行中…' : '运行'}</button>
        <div className={`query-transaction-controls${transactionActive ? ' active' : ''}`} title={transactionActive ? '当前查询页已开启事务' : '手动事务模式'}>
          <button type="button" onClick={() => void beginTransaction()} disabled={transactionBusy || transactionActive || !connectionId || !databaseName}>BEGIN</button>
          <button type="button" onClick={() => void finishTransaction(true)} disabled={transactionBusy || !transactionActive}>COMMIT</button>
          <button type="button" className="rollback" onClick={() => void finishTransaction(false)} disabled={transactionBusy || !transactionActive}>ROLLBACK</button>
        </div>
        <button type="button" className="format-query" onClick={() => void executeExplain()} disabled={running || !sql.trim()} title="一键分析执行计划 (EXPLAIN)"><ChartBar />执行计划</button>
        <button type="button" className="format-query" onClick={formatSql} disabled={!sql.trim()} title="格式化 SQL（Shift + Alt + F）"><TextAlignLeft />格式化</button>
        <button type="button" className="compress-query" onClick={compressSql} disabled={!sql.trim()} title="压缩 SQL（Shift + Alt + M）"><ArrowsInLineHorizontal />压缩</button>
        <div className="saved-query-menu-host" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="saved-query-toggle" onClick={() => setShowHistory((v) => !v)}>
            <ClockCounterClockwise />历史{sqlHistory.length ? ` ${sqlHistory.length}` : ''}<CaretDown />
          </button>
          {showHistory && (
            <div className="saved-query-menu">
              <header><strong>SQL 执行历史</strong><button type="button" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 11 }} onClick={() => { setSqlHistory([]); localStorage.removeItem('orbisql.sql-history.v1') }}><Trash />清空</button></header>
              <div className="saved-query-list">
                {sqlHistory.length === 0 && <div className="saved-query-empty"><ClockCounterClockwise /><span>还没有执行历史</span></div>}
                {sqlHistory.map((item: { sql: string; ts: number; success: boolean }) => (
                  <div className="saved-query-item" key={item.ts}>
                    <button type="button" className="saved-query-load" onClick={() => {
                      setSql(item.sql)
                      setShowHistory(false)
                      requestAnimationFrame(() => textareaRef.current?.focus())
                    }}>
                      <span><strong style={{ color: item.success ? 'var(--success)' : 'var(--error)' }}>{item.success ? '✓' : '✗'}</strong><small>{new Date(item.ts).toLocaleTimeString('zh-CN')}</small></span>
                      <code>{item.sql.replaceAll(/\s+/g, ' ').trim()}</code>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <button type="button" className="save-query-button" onClick={openSaveQueryDialog} disabled={!connectionId || !databaseName || !sql.trim()} title="保存查询（Command/Ctrl + S）"><FloppyDisk />保存查询</button>
        <div className="saved-query-menu-host" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="saved-query-toggle" onClick={() => setShowSnippets((current) => !current)}>
            <Lightning />常用 Snippets<CaretDown />
          </button>
          {showSnippets && (
            <div className="saved-query-menu">
              <header><strong>常用 SQL 代码片段</strong></header>
              <div className="saved-query-list">
                {PRESET_SNIPPETS.map((snippet) => (
                  <div className="saved-query-item" key={snippet.name}>
                    <button type="button" className="saved-query-load" onClick={() => {
                      setSql(snippet.sql)
                      setShowSnippets(false)
                      requestAnimationFrame(() => textareaRef.current?.focus())
                    }}>
                      <span><strong>{snippet.name}</strong></span>
                      <code>{snippet.sql.replaceAll(/\s+/g, ' ').trim()}</code>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="saved-query-menu-host" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="saved-query-toggle" disabled={!connectionId || !databaseName} onClick={() => setShowSavedQueries((current) => !current)}>
            <BookmarksSimple />已保存{savedQueries.length ? ` ${savedQueries.length}` : ''}<CaretDown />
          </button>
          {showSavedQueries && (
            <div className="saved-query-menu">
              <header><strong>已保存的查询</strong><span>{databaseName}</span></header>
              <div className="saved-query-list">
                {savedQueries.map((savedQuery) => (
                  <div className="saved-query-item" key={savedQuery.id}>
                    <button type="button" className="saved-query-load" title={savedQuery.sql} onClick={() => {
                      setSql(savedQuery.sql)
                      setResult(null)
                      setResultPanelVisible(false)
                      setFormatError('')
                      setSuggestions([])
                      setSaveQueryNotice(`已载入：${savedQuery.name}`)
                      setShowSavedQueries(false)
                      requestAnimationFrame(() => textareaRef.current?.focus())
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
            disabled={transactionActive}
            onChange={(value) => {
              setDatabaseKey(value)
              const [nextConnectionId, nextDatabaseName = ''] = value.split('\u0000')
              onDatabaseChange(nextConnectionId ? Number(nextConnectionId) : null, nextDatabaseName)
              setResult(null)
              setResultPanelVisible(false)
              setSuggestions([])
              setSaveQueryNotice('')
            }}
          />
        </div>
      </div>
      <div className={`query-validation${formatError || validation.messages.length ? ' error' : sql.trim() ? ' valid' : ''}`}>
        {formatError || validation.messages.length ? <WarningCircle /> : <Check />}
        <span>{formatError || (validation.messages.length ? validation.messages.join('；') : sql.trim() ? '字段检查通过' : '输入 SQL 后自动检查表和字段')}</span>
      </div>
      <div
        className={`sql-editor-shell${!resultPanelVisible || resultPanelCollapsed ? ' full-height' : ''}`}
        style={resultPanelVisible && !resultPanelCollapsed ? { height: `${editorHeightPercent}%` } : undefined}
      >
        <pre className="sql-highlight" ref={highlightRef} aria-hidden="true">
          {validation.tokens.map((token) => {
            const upper = identifierValue(token).toUpperCase()
            const className = [
              `sql-token-${token.kind}`,
              token.kind === 'word' && SQL_KEYWORD_SET.has(upper) ? 'sql-token-keyword' : '',
              token.kind === 'word' && SQL_FUNCTIONS.has(upper) ? 'sql-token-function' : '',
              validation.errorStarts.has(token.start) ? 'sql-token-error' : ''
            ].filter(Boolean).join(' ')
            return <span className={className} key={token.start}>{token.value}</span>
          })}
          {'\n'}
        </pre>
        <textarea
          ref={textareaRef}
          className="sql-editor"
          value={sql}
          onChange={changeSql}
          onKeyDown={handleEditorKeyDown}
          onKeyUp={(event) => updateCursorPosition(event.currentTarget)}
          onSelect={(event) => updateCursorPosition(event.currentTarget)}
          onClick={(event) => {
            updateSuggestions(sql, event.currentTarget.selectionStart, event.currentTarget)
            updateCursorPosition(event.currentTarget)
          }}
          onScroll={(event) => {
            if (!highlightRef.current) return
            highlightRef.current.scrollTop = event.currentTarget.scrollTop
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
          }}
          placeholder="在此输入 SQL 语句…"
          spellCheck={false}
          wrap="off"
        />
        {suggestions.length > 0 && (
          <div className="sql-suggestions" style={suggestionPosition}>
            {suggestions.map((suggestion, index) => (
              <button
                type="button"
                className={index === suggestionIndex ? 'selected' : ''}
                key={suggestion}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySuggestion(suggestion)}
              >
                <Code /><span>{suggestion}</span>
              </button>
            ))}
          </div>
        )}
      </div>
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
            <button type="button" title={resultPanelCollapsed ? '展开结果区域' : '收起结果区域'} onClick={() => setResultPanelCollapsed((current) => !current)}>
              {resultPanelCollapsed ? <CaretDown /> : <CaretUp />}
            </button>
            <button type="button" title="关闭结果页" onClick={() => { setResultPanelVisible(false); setResultContextMenu(null) }}><X /></button>
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
                  <button type="button" className="query-error-copy-btn" onClick={copyErrorMessage}><Copy />{errorCopied ? '已复制' : '复制错误信息'}</button>
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
                  <div><p>{item.message}</p>{item.rows && item.columns && <div className="query-batch-preview"><table><thead><tr>{item.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{item.rows.slice(0, 20).map((row, rowIndex) => <tr key={rowIndex}>{item.columns!.map((column) => <td key={column}>{displayValue(row[column])}</td>)}</tr>)}</tbody></table>{item.rows.length > 20 && <span>仅预览前 20 行，共 {item.rows.length} 行</span>}</div>}</div>
                </details>)}
              </div>}
            </div>
          )}

          {resultPanelTab === 'result' && result?.success && result.columns && result.rows && (
            <div className="query-result-data-view">
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
              {resultDataTab === 'data' ? <div className="query-table-wrap">
                <table className="query-table">
                  <thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
                  <tbody>{result.rows.map((row, index) => <tr key={index}>
                    {result.columns!.map((column) => {
                      const editableColumn = result.editable?.columns.find((item) => item.resultName === column)
                      const isEditing = editingCell?.rowIndex === index && editingCell.column === column
                      return <td
                        key={column}
                        className={`${editableColumn ? 'editable-cell' : ''}${isEditing ? ' editing-cell' : ''}`}
                        onClick={() => editableColumn && !isEditing && startEditingCell(index, column)}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          setResultContextMenu({ x: Math.min(event.clientX, window.innerWidth - 196), y: Math.min(event.clientY, window.innerHeight - 190), rowIndex: index, column })
                        }}
                      >
                        {isEditing && editableColumn
                          ? <div className="cell-editor" onClick={(event) => event.stopPropagation()}>
                            <input
                              autoFocus
                              value={draftCellValue === null || draftCellValue === undefined ? '' : String(draftCellValue)}
                              onChange={(event) => setDraftCellValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') { event.preventDefault(); void saveEditingCell() }
                                if (event.key === 'Escape') setEditingCell(null)
                              }}
                            />
                            <button type="button" title="保存字段" disabled={savingRow} onClick={() => void saveEditingCell()}><FloppyDisk /></button>
                            <button type="button" title="取消编辑" disabled={savingRow} onClick={() => setEditingCell(null)}><X /></button>
                          </div>
                          : displayValue(row[column])}
                      </td>
                    })}
                  </tr>)}</tbody>
                </table>
              </div> : resultDataTab === 'chart' ? <QueryResultChart columns={result.columns} rows={result.rows} /> : <div className="query-result-info">
                <dl><dt>返回记录</dt><dd>{result.rows.length}</dd></dl>
                <dl><dt>字段数量</dt><dd>{result.columns.length}</dd></dl>
                <dl><dt>运行时间</dt><dd>{formatDurationSeconds(result.durationMs)}</dd></dl>
                <dl><dt>编辑状态</dt><dd>{result.editable ? `可编辑（${result.editable.tableName}）` : '只读'}</dd></dl>
              </div>}
            </div>
          )}
        </div>}

        {!resultPanelCollapsed && <footer className="query-result-footer">
          <span>{result?.rows ? `${result.rows.length} 条记录` : result ? formatDurationSeconds(result.durationMs) : '就绪'}</span>
          <span>Line: {cursorPosition.line}&nbsp;&nbsp;Col: {cursorPosition.column}</span>
        </footer>}
      </section>}
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
              <button type="button" onClick={() => void copyText(buildInsertSql(resultContextMenu.rowIndex), '新增语句已复制')}><Copy />复制为新增语句</button>
              <button type="button" onClick={() => void copyText(buildUpdateSql(resultContextMenu.rowIndex), '修改语句已复制')}><Copy />复制为修改语句</button>
              <button type="button" disabled={!resultContextMenu.column} onClick={() => void copyText(resultContextMenu.column, '字段名称已复制')}><Copy />复制字段名称</button>
            </div>}
          </div>
        </div>
      )}
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
