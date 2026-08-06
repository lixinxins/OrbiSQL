import type { AiProviderType, AiSaveModelInput, AiStoredModel } from '../../shared/ai-agent'
import type { SqliteDatabase } from '../services/sqlite-runtime'
import { decryptPassword, encryptPassword } from './password-crypto'

interface AiModelRow {
  id: number
  name: string
  provider: AiProviderType
  endpoint: string
  model_name: string
  api_key_cipher: Uint8Array | null
  created_at: string
  updated_at: string
}

export interface StoredAiModel extends AiStoredModel {
  apiKey: string
}

export class AiModelsRepository {
  constructor(private readonly database: SqliteDatabase) {}

  private mapRow(row: AiModelRow): StoredAiModel {
    return {
      id: Number(row.id),
      name: row.name,
      provider: row.provider,
      endpoint: row.endpoint,
      model: row.model_name,
      apiKey: decryptPassword(row.api_key_cipher) ?? '',
      hasApiKey: Boolean(row.api_key_cipher),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }

  listAiModels(): StoredAiModel[] {
    const rows = this.database.prepare(`
      SELECT id, name, provider, endpoint, model_name, api_key_cipher, created_at, updated_at
      FROM ai_models ORDER BY updated_at DESC, id ASC
    `).all() as unknown as AiModelRow[]
    return rows.map((row) => this.mapRow(row))
  }

  getAiModel(id: number): StoredAiModel | null {
    const row = this.database.prepare(
      'SELECT id, name, provider, endpoint, model_name, api_key_cipher, created_at, updated_at FROM ai_models WHERE id = ?'
    ).get(id) as unknown as AiModelRow | undefined
    if (!row) return null
    return this.mapRow(row)
  }

  saveAiModel(input: AiSaveModelInput): StoredAiModel {
    const current = input.id ? this.getAiModel(input.id) : null
    const existingCipher = current?.hasApiKey
      ? (this.database.prepare('SELECT api_key_cipher FROM ai_models WHERE id = ?').get(input.id!) as unknown as { api_key_cipher: Uint8Array | null }).api_key_cipher
      : null
    const apiKeyCipher = input.apiKey?.trim() ? encryptPassword(input.apiKey.trim()) : existingCipher
    if (input.id) {
      this.database.prepare(`
        UPDATE ai_models SET name = ?, provider = ?, endpoint = ?, model_name = ?, api_key_cipher = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(input.name.trim(), input.provider, input.endpoint.trim(), input.model.trim(), apiKeyCipher, input.id)
      const saved = this.getAiModel(input.id)
      if (!saved) throw new Error('模型配置不存在')
      return saved
    }
    const result = this.database.prepare(`
      INSERT INTO ai_models (name, provider, endpoint, model_name, api_key_cipher) VALUES (?, ?, ?, ?, ?)
    `).run(input.name.trim(), input.provider, input.endpoint.trim(), input.model.trim(), apiKeyCipher)
    return this.getAiModel(Number(result.lastInsertRowid))!
  }

  deleteAiModel(id: number): boolean {
    return Number(this.database.prepare('DELETE FROM ai_models WHERE id = ?').run(id).changes) > 0
  }
}
