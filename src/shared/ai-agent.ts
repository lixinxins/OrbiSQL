import type { QueryExecutionResult } from './connections'

export type AiProviderType = 'openai-responses' | 'openai-compatible' | 'ollama'
export type AiSqlRisk = 'read' | 'write' | 'dangerous'

export interface AiModelConfig {
  provider: AiProviderType
  endpoint: string
  model: string
  apiKey?: string
}

export interface AiConversationMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiAgentRequest {
  connectionId: number
  databaseName: string
  tableName?: string
  prompt: string
  history: AiConversationMessage[]
  modelId: number
}

export interface AiStoredModel {
  id: number
  name: string
  provider: AiProviderType
  endpoint: string
  model: string
  hasApiKey: boolean
  createdAt: string
  updatedAt: string
}

export interface AiSaveModelInput {
  id?: number
  name: string
  provider: AiProviderType
  endpoint: string
  model: string
  apiKey?: string
}

export interface AiModelActionResult {
  success: boolean
  message: string
  model?: AiStoredModel
}

export interface AiSqlProposal {
  sql: string
  risk: AiSqlRisk
  explanation: string
}

export interface AiAgentResponse {
  success: boolean
  message: string
  proposal?: AiSqlProposal
  result?: QueryExecutionResult
}

export interface AiExecuteProposalRequest {
  connectionId: number
  databaseName: string
  sql: string
  approved: boolean
}

export interface AiModelPreset {
  provider: AiProviderType
  label: string
  defaultEndpoint: string
  defaultModel: string
  requiresApiKey: boolean
}
