import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, Code, Database, GearSix, PaperPlaneTilt, Plus, Robot, ShieldWarning, Sparkle, Trash, User } from '@phosphor-icons/react'
import type { AiAgentResponse, AiConversationMessage, AiSaveModelInput, AiStoredModel } from '../../../shared/ai-agent'
import type { DatabaseConnection, QueryExecutionResult } from '../../../shared/connections'
import AiModelSettingsDialog from './AiModelSettingsDialog'
import { useConfirmDialog } from './ConfirmDialog'
import SearchableSelect from './SearchableSelect'

interface AiDatabaseWorkspaceProps {
  active: boolean
  connections: DatabaseConnection[]
}

interface UiMessage extends AiConversationMessage {
  id: string
  response?: AiAgentResponse
}

interface AiChatSession {
  id: string
  title: string
  connectionId: number | null
  databaseName: string
  tableName: string
  modelId: number | null
  messages: UiMessage[]
  updatedAt: number
}

const SESSION_STORAGE_KEY = 'orbisql.ai.sessions.v1'
const ACTIVE_SESSION_KEY = 'orbisql.ai.active-session.v1'

const loadSessions = (): AiChatSession[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? '[]') as AiChatSession[]
    return Array.isArray(stored) ? stored.slice(0, 50) : []
  } catch {
    return []
  }
}

const resultValue = (value: unknown): string => {
  if (value === null) return 'NULL'
  if (value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const sessionTime = (timestamp: number): string => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
}).format(timestamp)

function ResultPreview({ result }: { result: QueryExecutionResult }) {
  if (!result.columns || !result.rows) return <p className={result.success ? 'ai-result-notice success' : 'ai-result-notice error'}>{result.message}</p>
  return <div className="ai-result-preview">
    <div><span>{result.rows.length} 条记录</span><span>{result.durationMs === undefined ? '' : `${result.durationMs}ms`}</span></div>
    <div className="ai-result-table-wrap">
      <table><thead><tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{result.rows.slice(0, 100).map((row, index) => <tr key={index}>{result.columns!.map((column) => <td key={column} title={resultValue(row[column])}>{resultValue(row[column])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </div>
}

function AiDatabaseWorkspace({ active, connections }: AiDatabaseWorkspaceProps) {
  const { confirm, confirmDialog } = useConfirmDialog()
  const [models, setModels] = useState<AiStoredModel[]>([])
  const [sessions, setSessions] = useState<AiChatSession[]>(loadSessions)
  const [activeSessionId, setActiveSessionId] = useState(() => localStorage.getItem(ACTIVE_SESSION_KEY) ?? '')
  const [showModelSettings, setShowModelSettings] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [sending, setSending] = useState(false)
  const messageEndRef = useRef<HTMLDivElement>(null)

  const availableConnections = useMemo(() => connections.filter((connection) => connection.open), [connections])
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? sessions[0]
  const connectionId = activeSession?.connectionId ?? null
  const databaseName = activeSession?.databaseName ?? ''
  const tableName = activeSession?.tableName ?? ''
  const selectedModelId = activeSession?.modelId ?? null
  const messages = activeSession?.messages ?? []
  const selectedConnection = availableConnections.find((connection) => connection.id === connectionId)
  const selectedDatabase = selectedConnection?.databases.find((database) => database.name === databaseName)
  const selectedModel = models.find((model) => model.id === selectedModelId)

  const connectionOptions = useMemo(() => availableConnections.map((connection) => ({
    value: String(connection.id), label: `${connection.name} · ${connection.engine}`, keywords: `${connection.host} ${connection.defaultDatabase ?? ''}`
  })), [availableConnections])
  const databaseOptions = useMemo(() => selectedConnection?.databases.map((database) => ({
    value: database.name, label: database.name, keywords: `${database.charset ?? ''} ${database.collation ?? ''}`
  })) ?? [], [selectedConnection])
  const tableOptions = useMemo(() => [
    { value: '', label: '全部数据表', keywords: 'all 全部' },
    ...(selectedDatabase?.tables.map((table) => ({ value: table.name, label: table.comment ? `${table.name} · ${table.comment}` : table.name, keywords: `${table.name} ${table.comment ?? ''}` })) ?? [])
  ], [selectedDatabase])
  const modelOptions = useMemo(() => models.map((model) => ({ value: String(model.id), label: model.name, keywords: `${model.provider} ${model.model}` })), [models])

  const createSession = (modelId: number | null = models[0]?.id ?? null): void => {
    const connection = availableConnections[0]
    const session: AiChatSession = {
      id: crypto.randomUUID(),
      title: '新会话',
      connectionId: connection?.id ?? null,
      databaseName: connection?.databases[0]?.name ?? '',
      tableName: '',
      modelId,
      messages: [],
      updatedAt: Date.now()
    }
    setSessions((current) => [session, ...current])
    setActiveSessionId(session.id)
    setPrompt('')
  }

  const updateActiveSession = (patch: Partial<AiChatSession>): void => {
    if (!activeSession) return
    setSessions((current) => current.map((session) => session.id === activeSession.id ? { ...session, ...patch, updatedAt: Date.now() } : session))
  }

  useEffect(() => {
    void window.omnidb.ai.listModels().then(setModels)
  }, [])

  useEffect(() => {
    if (!models.length) return
    if (!sessions.length) {
      createSession(models[0].id)
      return
    }
    if (!activeSessionId || !sessions.some((session) => session.id === activeSessionId)) setActiveSessionId(sessions[0].id)
    if (activeSession && !models.some((model) => model.id === activeSession.modelId)) updateActiveSession({ modelId: models[0].id })
  }, [models, sessions.length, activeSessionId])

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions.slice(0, 50)))
    } catch (error) {
      console.warn('保存 AI 会话记录失败：', error)
    }
  }, [sessions])

  useEffect(() => {
    if (activeSessionId) localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId)
  }, [activeSessionId])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, sending])

  const addMessages = (...nextMessages: UiMessage[]): void => {
    updateActiveSession({ messages: [...messages, ...nextMessages] })
  }

  const send = async (): Promise<void> => {
    const content = prompt.trim()
    if (!content || sending) return
    if (!connectionId || !databaseName) {
      addMessages({ id: crypto.randomUUID(), role: 'assistant', content: '请先选择连接和数据库。' })
      return
    }
    if (!selectedModelId) {
      setShowModelSettings(true)
      return
    }
    const userMessage: UiMessage = { id: crypto.randomUUID(), role: 'user', content }
    const history = messages.map(({ role, content: messageContent }) => ({ role, content: messageContent }))
    updateActiveSession({
      title: messages.length ? activeSession?.title : content.slice(0, 24),
      messages: [...messages, userMessage]
    })
    setPrompt('')
    setSending(true)
    try {
      const response = await window.omnidb.ai.chat({ connectionId, databaseName, tableName: tableName || undefined, prompt: content, history, modelId: selectedModelId })
      setSessions((current) => current.map((session) => session.id === activeSession?.id
        ? { ...session, messages: [...session.messages, { id: crypto.randomUUID(), role: 'assistant', content: response.message, response }], updatedAt: Date.now() }
        : session))
    } catch (error) {
      setSessions((current) => current.map((session) => session.id === activeSession?.id
        ? { ...session, messages: [...session.messages, { id: crypto.randomUUID(), role: 'assistant', content: error instanceof Error ? error.message : 'AI Agent 请求失败' }], updatedAt: Date.now() }
        : session))
    } finally {
      setSending(false)
    }
  }

  const executeProposal = async (messageId: string, response: AiAgentResponse): Promise<void> => {
    if (!connectionId || !databaseName || !response.proposal) return
    const dangerous = response.proposal.risk === 'dangerous'
    const approved = await confirm({
      title: dangerous ? '确认执行高风险 SQL' : '确认修改数据库',
      message: dangerous ? '该语句可能修改数据库结构或删除大量数据。' : '该语句会修改数据库中的数据。',
      detail: response.proposal.sql,
      confirmLabel: '确认执行'
    })
    if (!approved) return
    setSending(true)
    try {
      const executed = await window.omnidb.ai.executeProposal({ connectionId, databaseName, sql: response.proposal.sql, approved: true })
      updateActiveSession({ messages: messages.map((message) => message.id === messageId ? { ...message, content: executed.message, response: executed } : message) })
    } finally {
      setSending(false)
    }
  }

  const deleteSession = async (session: AiChatSession): Promise<void> => {
    if (!await confirm({ title: '删除会话', message: `确定删除“${session.title}”吗？`, detail: '该会话中的聊天记录将无法恢复。', confirmLabel: '删除' })) return
    const remaining = sessions.filter((item) => item.id !== session.id)
    setSessions(remaining)
    if (session.id === activeSessionId) {
      if (remaining[0]) setActiveSessionId(remaining[0].id)
      else createSession(selectedModelId)
    }
  }

  const clearMessages = async (): Promise<void> => {
    if (!messages.length || !await confirm({ title: '清空聊天记录', message: '确定清空当前会话中的全部聊天记录吗？', detail: '连接、数据库、数据表和模型选择将继续保留。', confirmLabel: '清空' })) return
    updateActiveSession({ title: '新会话', messages: [] })
  }

  const saveModel = async (input: AiSaveModelInput): Promise<void> => {
    const result = await window.omnidb.ai.saveModel(input)
    if (!result.success || !result.model) throw new Error(result.message)
    const nextModels = await window.omnidb.ai.listModels()
    setModels(nextModels)
  }

  const deleteModel = async (model: AiStoredModel): Promise<void> => {
    if (!await confirm({ title: '删除模型', message: `确定删除“${model.name}”吗？`, detail: '已保存的接口地址和 API Key 将一起删除。', confirmLabel: '删除' })) return
    const result = await window.omnidb.ai.deleteModel(model.id)
    if (!result.success) throw new Error(result.message)
    const nextModels = await window.omnidb.ai.listModels()
    setModels(nextModels)
    if (selectedModelId === model.id) updateActiveSession({ modelId: nextModels[0]?.id ?? null })
  }

  return <section className={`ai-database-workspace${active ? ' active' : ''}`}>
    <div className="ai-workspace-layout">
      <aside className="ai-session-sidebar">
        <header><strong>会话</strong><button type="button" title="新建会话" onClick={() => createSession(selectedModelId)}><Plus /></button></header>
        <div className="ai-session-list">{sessions.map((session) => <div className={`ai-session-item${session.id === activeSession?.id ? ' active' : ''}`} key={session.id}>
          <button type="button" className="ai-session-open" onClick={() => { setActiveSessionId(session.id); setPrompt('') }}><span>{session.title}</span><small>{sessionTime(session.updatedAt)}</small></button>
          <button type="button" className="ai-session-delete" title="删除会话" onClick={() => void deleteSession(session)}><Trash /></button>
        </div>)}</div>
        <footer className="ai-session-footer"><button type="button" onClick={() => setShowModelSettings(true)}><GearSix /><span>模型设置</span></button></footer>
      </aside>

      <div className="ai-chat-panel">
        <header className="ai-database-header">
          <div className="ai-database-target">
            <div className="ai-target-field"><span>连接</span><SearchableSelect value={connectionId ? String(connectionId) : ''} options={connectionOptions} placeholder="选择连接" onChange={(value) => {
              const nextId = Number(value) || null
              const connection = availableConnections.find((item) => item.id === nextId)
              updateActiveSession({ connectionId: nextId, databaseName: connection?.databases[0]?.name ?? '', tableName: '', messages: [] })
            }} /></div>
            <div className="ai-target-field"><span>数据库</span><SearchableSelect value={databaseName} options={databaseOptions} placeholder="选择数据库" disabled={!selectedConnection} onChange={(value) => updateActiveSession({ databaseName: value, tableName: '', messages: [] })} /></div>
            <div className="ai-target-field"><span>数据表</span><SearchableSelect value={tableName} options={tableOptions} placeholder="选择数据表" disabled={!selectedDatabase} onChange={(value) => updateActiveSession({ tableName: value, messages: [] })} /></div>
          </div>
        </header>

        <div className="ai-conversation">
          {!messages.length && <div className="ai-empty-state"><Robot weight="duotone" /><h2>用自然语言操作数据库</h2><p>{selectedModel ? `当前模型：${selectedModel.name} · ${selectedModel.model}` : '请先添加或选择一个模型'}</p><div><span><CheckCircle />查询语句自动执行</span><span><ShieldWarning />写入操作确认后执行</span><span><Database />自动读取当前库结构</span></div></div>}
          {messages.map((message) => <article className={`ai-message ${message.role}`} key={message.id}>
            <span className="ai-message-avatar">{message.role === 'user' ? <User /> : <Sparkle weight="fill" />}</span>
            <div className="ai-message-content"><p>{message.content}</p>
              {message.response?.proposal && <div className={`ai-sql-proposal ${message.response.proposal.risk}`}><header><span><Code />SQL 提案</span><em>{message.response.proposal.risk === 'read' ? '只读' : message.response.proposal.risk === 'write' ? '写入' : '高风险'}</em></header><pre>{message.response.proposal.sql}</pre>{message.response.proposal.risk !== 'read' && !message.response.result && <button type="button" onClick={() => void executeProposal(message.id, message.response!)}><ShieldWarning />确认并执行</button>}</div>}
              {message.response?.result && <ResultPreview result={message.response.result} />}
            </div>
          </article>)}
          {sending && <article className="ai-message assistant"><span className="ai-message-avatar"><Sparkle weight="fill" /></span><div className="ai-message-content ai-thinking"><i /><i /><i /><span>Agent 正在分析数据库结构…</span></div></article>}
          <div ref={messageEndRef} />
        </div>

        <footer className="ai-composer">
          <div className="ai-composer-box">
            <textarea value={prompt} disabled={sending} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={tableName ? `描述你想对 ${tableName} 完成的操作…` : '描述你想查询、统计或修改的数据…'} />
            <div className="ai-composer-toolbar">
              <div className="ai-composer-model"><Robot /><SearchableSelect value={selectedModelId ? String(selectedModelId) : ''} options={modelOptions} placeholder="选择模型" disabled={!models.length} onChange={(value) => updateActiveSession({ modelId: Number(value) || null })} /></div>
              <small>Enter 发送 · Shift + Enter 换行 · 写操作需要确认</small>
              <div className="ai-composer-actions"><button type="button" className="ai-clear-chat" disabled={!messages.length || sending} onClick={() => void clearMessages()}><Trash /><span>清空</span></button><button type="button" className="ai-send-button" disabled={sending || !prompt.trim()} onClick={() => void send()}><PaperPlaneTilt weight="fill" /><span>发送</span></button></div>
            </div>
          </div>
        </footer>
      </div>
    </div>
    {showModelSettings && <AiModelSettingsDialog models={models} selectedModelId={selectedModelId} onSave={saveModel} onDelete={deleteModel} onClose={() => setShowModelSettings(false)} />}
    {confirmDialog}
  </section>
}

export default AiDatabaseWorkspace
