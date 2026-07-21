import type {
  AiAgentRequest,
  AiAgentResponse,
  AiConversationMessage,
  AiExecuteProposalRequest,
  AiModelConfig,
  AiModelActionResult,
  AiModelPreset,
  AiSaveModelInput,
  AiStoredModel,
  AiProviderType,
  AiSqlProposal,
  AiSqlRisk
} from '../../shared/ai-agent'
import type { DatabaseConnection, DatabaseItem, QueryExecutionResult } from '../../shared/connections'
import { ConnectionService } from './connection-service'
import { ConnectionRepository } from '../database/connection-repository'

interface ModelCompletionInput {
  system: string
  messages: AiConversationMessage[]
  prompt: string
}

interface ModelAdapter {
  complete(config: AiModelConfig, input: ModelCompletionInput): Promise<string>
}

const jsonHeaders = (apiKey?: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {})
})

const endpointFor = (base: string, path: string): string => {
  const normalized = base.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalized)) throw new Error('模型接口地址必须以 http:// 或 https:// 开头')
  return normalized.endsWith(path) ? normalized : `${normalized}${path}`
}

const requestJson = async (url: string, init: RequestInit): Promise<Record<string, unknown>> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) })
  const text = await response.text()
  let payload: Record<string, unknown> = {}
  try { payload = text ? JSON.parse(text) as Record<string, unknown> : {} } catch { payload = { raw: text } }
  if (!response.ok) {
    const error = payload.error as Record<string, unknown> | undefined
    throw new Error(String(error?.message ?? payload.message ?? payload.raw ?? `模型请求失败（${response.status}）`))
  }
  return payload
}

class OpenAiResponsesAdapter implements ModelAdapter {
  async complete(config: AiModelConfig, input: ModelCompletionInput): Promise<string> {
    if (!config.apiKey?.trim()) throw new Error('请输入 API Key')
    const payload = await requestJson(endpointFor(config.endpoint, '/responses'), {
      method: 'POST',
      headers: jsonHeaders(config.apiKey),
      body: JSON.stringify({
        model: config.model,
        instructions: input.system,
        input: [
          ...input.messages.map((message) => ({ role: message.role, content: message.content })),
          { role: 'user', content: input.prompt }
        ]
      })
    })
    if (typeof payload.output_text === 'string') return payload.output_text
    const output = Array.isArray(payload.output) ? payload.output as Array<Record<string, unknown>> : []
    const text = output.flatMap((item) => Array.isArray(item.content) ? item.content as Array<Record<string, unknown>> : [])
      .map((content) => content.text)
      .find((value): value is string => typeof value === 'string')
    if (!text) throw new Error('模型没有返回可解析的内容')
    return text
  }
}

class OpenAiCompatibleAdapter implements ModelAdapter {
  async complete(config: AiModelConfig, input: ModelCompletionInput): Promise<string> {
    const payload = await requestJson(endpointFor(config.endpoint, '/chat/completions'), {
      method: 'POST',
      headers: jsonHeaders(config.apiKey),
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: input.system },
          ...input.messages,
          { role: 'user', content: input.prompt }
        ]
      })
    })
    const choices = Array.isArray(payload.choices) ? payload.choices as Array<Record<string, unknown>> : []
    const message = choices[0]?.message as Record<string, unknown> | undefined
    if (typeof message?.content !== 'string') throw new Error('模型没有返回可解析的内容')
    return message.content
  }
}

class OllamaAdapter implements ModelAdapter {
  async complete(config: AiModelConfig, input: ModelCompletionInput): Promise<string> {
    const payload = await requestJson(endpointFor(config.endpoint, '/api/chat'), {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        model: config.model,
        stream: false,
        messages: [
          { role: 'system', content: input.system },
          ...input.messages,
          { role: 'user', content: input.prompt }
        ]
      })
    })
    const message = payload.message as Record<string, unknown> | undefined
    if (typeof message?.content !== 'string') throw new Error('Ollama 没有返回可解析的内容')
    return message.content
  }
}

const MODEL_PRESETS: AiModelPreset[] = [
  { provider: 'openai-responses', label: 'OpenAI Responses', defaultEndpoint: 'https://api.openai.com/v1', defaultModel: 'gpt-5.6-sol', requiresApiKey: true },
  { provider: 'openai-compatible', label: 'OpenAI 兼容接口', defaultEndpoint: 'https://api.openai.com/v1', defaultModel: 'gpt-5.6-sol', requiresApiKey: true },
  { provider: 'ollama', label: 'Ollama 本地模型', defaultEndpoint: 'http://localhost:11434', defaultModel: 'qwen3', requiresApiKey: false }
]

const ADAPTERS: Record<AiProviderType, ModelAdapter> = {
  'openai-responses': new OpenAiResponsesAdapter(),
  'openai-compatible': new OpenAiCompatibleAdapter(),
  ollama: new OllamaAdapter()
}

const stripCodeFence = (value: string): string => value.trim()
  .replace(/^```(?:json|sql)?\s*/i, '')
  .replace(/\s*```$/, '')
  .trim()

const extractJson = (value: string): Record<string, unknown> => {
  const cleaned = stripCodeFence(value)
  try { return JSON.parse(cleaned) as Record<string, unknown> } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    throw new Error('模型返回格式不正确，请重试')
  }
}

const sqlRisk = (sql: string): AiSqlRisk => {
  const normalized = sql.replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, '').trim().toUpperCase()
  if (/\b(DROP|TRUNCATE|ALTER|RENAME|GRANT|REVOKE|DELETE)\b/.test(normalized)) return 'dangerous'
  if (/^UPDATE\b/.test(normalized) && !/\bWHERE\b/.test(normalized)) return 'dangerous'
  if (/^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/.test(normalized)) return 'read'
  if (/^WITH\b/.test(normalized) && !/\b(INSERT|UPDATE|DELETE|MERGE|REPLACE|CREATE|DROP|ALTER)\b/.test(normalized)) return 'read'
  if (/^PRAGMA\s+[A-Z0-9_]+\s*(?:\([^)]*\))?\s*$/.test(normalized)) return 'read'
  return 'write'
}

const validateSingleStatement = (sql: string): string => {
  const trimmed = stripCodeFence(sql).replace(/;\s*$/, '').trim()
  if (!trimmed) throw new Error('模型没有生成 SQL')
  if (trimmed.includes(';')) throw new Error('Agent 一次只允许生成一条 SQL 语句')
  return trimmed
}

const schemaText = (connection: DatabaseConnection, database: DatabaseItem, tableName?: string): string => JSON.stringify({
  engine: connection.engine,
  database: database.name,
  selectedTable: tableName || null,
  tables: database.tables.filter((table) => !tableName || table.name === tableName).slice(0, 120).map((table) => ({
    name: table.name,
    comment: table.comment ?? '',
    columns: table.columns
  })),
  views: database.views.slice(0, 80)
})

const SYSTEM_PROMPT = `你是桌面数据库管理工具中的 SQL Agent。
你的任务是根据用户自然语言和给定数据库结构，生成一条符合当前数据库方言的 SQL。
规则：
1. 只能使用结构中真实存在的表和字段，不得猜测名称。
2. 一次最多生成一条 SQL，不得生成多语句。
3. 普通明细查询默认限制为 200 行；聚合查询不需要 LIMIT。
4. 不要执行 SQL，只返回提案。
5. 如果需求信息不足，sql 返回空字符串，并在 message 中说明需要用户补充什么。
6. 仅返回 JSON，不要 Markdown：{"message":"给用户的简短说明","sql":"SQL语句"}。`

export class AiAgentService {
  constructor(private readonly connectionService: ConnectionService, private readonly repository: ConnectionRepository) {}

  listModelPresets(): AiModelPreset[] {
    return MODEL_PRESETS
  }

  listModels(): AiStoredModel[] {
    return this.repository.listAiModels().map(({ apiKey: _apiKey, ...model }) => model)
  }

  saveModel(input: AiSaveModelInput): AiModelActionResult {
    if (!input.name.trim()) return { success: false, message: '请输入配置名称' }
    if (!input.endpoint.trim()) return { success: false, message: '请输入接口地址' }
    if (!input.model.trim()) return { success: false, message: '请输入模型名称' }
    try {
      const { apiKey: _apiKey, ...model } = this.repository.saveAiModel(input)
      return { success: true, message: input.id ? '模型配置已更新' : '模型配置已添加', model }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : '保存模型配置失败' }
    }
  }

  deleteModel(id: number): AiModelActionResult {
    if (this.repository.listAiModels().length <= 1) return { success: false, message: '至少需要保留一个模型配置' }
    return this.repository.deleteAiModel(id)
      ? { success: true, message: '模型配置已删除' }
      : { success: false, message: '模型配置不存在' }
  }

  async chat(request: AiAgentRequest): Promise<AiAgentResponse> {
    if (!request.prompt.trim()) return { success: false, message: '请输入你想完成的数据库操作' }
    const storedModel = this.repository.getAiModel(request.modelId)
    if (!storedModel) return { success: false, message: '请选择模型配置' }
    const model: AiModelConfig = storedModel
    const connections = await this.connectionService.list()
    const connection = connections.find((item) => item.id === request.connectionId)
    const database = connection?.databases.find((item) => item.name === request.databaseName)
    if (!connection || !database) return { success: false, message: '请选择已打开的连接和数据库' }

    try {
      const adapter = ADAPTERS[model.provider]
      const raw = await adapter.complete(model, {
        system: SYSTEM_PROMPT,
        messages: request.history.slice(-12),
        prompt: `数据库结构：${schemaText(connection, database, request.tableName)}\n\n用户请求：${request.prompt.trim()}`
      })
      const parsed = extractJson(raw)
      const message = typeof parsed.message === 'string' ? parsed.message : '已生成 SQL'
      if (typeof parsed.sql !== 'string' || !parsed.sql.trim()) return { success: true, message }
      const sql = validateSingleStatement(parsed.sql)
      const proposal: AiSqlProposal = { sql, risk: sqlRisk(sql), explanation: message }
      if (proposal.risk !== 'read') {
        return { success: true, message: '该操作会修改数据库，请确认 SQL 后再执行。', proposal }
      }
      const result = await this.connectionService.executeQuery(request.connectionId, request.databaseName, sql)
      return { success: result.success, message: result.message, proposal, result }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'AI Agent 执行失败' }
    }
  }

  async executeProposal(request: AiExecuteProposalRequest): Promise<AiAgentResponse> {
    try {
      const sql = validateSingleStatement(request.sql)
      if (sqlRisk(sql) !== 'read' && request.approved !== true) return { success: false, message: '该 SQL 需要用户确认后才能执行' }
      const result: QueryExecutionResult = await this.connectionService.executeQuery(request.connectionId, request.databaseName, sql)
      return {
        success: result.success,
        message: result.message,
        proposal: { sql, risk: sqlRisk(sql), explanation: result.message },
        result
      }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'SQL 执行失败' }
    }
  }
}
