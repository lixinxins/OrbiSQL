import { useEffect, useState } from 'react'
import { Check, Cloud, GearSix, HardDrives, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react'
import type { AiProviderType, AiSaveModelInput, AiStoredModel } from '../../../shared/ai-agent'

interface AiModelSettingsDialogProps {
  models: AiStoredModel[]
  selectedModelId: number | null
  onSave: (input: AiSaveModelInput) => Promise<void>
  onDelete: (model: AiStoredModel) => Promise<void>
  onClose: () => void
}

const PROVIDERS: Array<{ value: AiProviderType; label: string; description: string; endpoint: string; model: string }> = [
  { value: 'openai-responses', label: 'OpenAI', description: 'Responses API', endpoint: 'https://api.openai.com/v1', model: 'gpt-5.6-sol' },
  { value: 'openai-compatible', label: '兼容接口', description: 'OpenAI Chat API', endpoint: 'https://api.openai.com/v1', model: 'gpt-5.6-sol' },
  { value: 'ollama', label: 'Ollama', description: '本机运行模型', endpoint: 'http://localhost:11434', model: 'qwen3' }
]

const emptyModel = (): AiSaveModelInput => ({ name: '', provider: 'openai-compatible', endpoint: 'https://api.openai.com/v1', model: 'gpt-5.6-sol', apiKey: '' })

function AiModelSettingsDialog({ models, selectedModelId, onSave, onDelete, onClose }: AiModelSettingsDialogProps) {
  const [form, setForm] = useState<AiSaveModelInput>(emptyModel)
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const startAdding = (): void => {
    setForm(emptyModel())
    setHasStoredKey(false)
    setNotice(null)
  }

  const edit = (model: AiStoredModel): void => {
    setForm({ id: model.id, name: model.name, provider: model.provider, endpoint: model.endpoint, model: model.model, apiKey: '' })
    setHasStoredKey(model.hasApiKey)
    setNotice(null)
  }

  const chooseProvider = (provider: AiProviderType): void => {
    const preset = PROVIDERS.find((item) => item.value === provider)!
    setForm((current) => ({ ...current, provider, endpoint: preset.endpoint, model: preset.model, apiKey: provider === 'ollama' ? '' : current.apiKey }))
  }

  const save = async (): Promise<void> => {
    if (!form.name.trim() || !form.endpoint.trim() || !form.model.trim()) {
      setNotice({ type: 'error', text: '请完整填写配置名称、接口地址和模型名称。' })
      return
    }
    setSaving(true)
    setNotice(null)
    try {
      const editing = Boolean(form.id)
      await onSave(form)
      if (!editing) startAdding()
      else setHasStoredKey(hasStoredKey || Boolean(form.apiKey?.trim()))
      setNotice({ type: 'success', text: editing ? '模型配置已保存' : '模型配置已添加，可在聊天框中选择使用' })
    } catch (saveError) {
      setNotice({ type: 'error', text: saveError instanceof Error ? saveError.message : '保存模型失败' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (model: AiStoredModel): Promise<void> => {
    try {
      await onDelete(model)
      if (form.id === model.id) startAdding()
      setNotice({ type: 'success', text: '模型配置已删除' })
    } catch (deleteError) {
      setNotice({ type: 'error', text: deleteError instanceof Error ? deleteError.message : '删除模型失败' })
    }
  }

  return <div className="settings-backdrop ai-model-dialog-backdrop" onMouseDown={onClose}>
    <section className="ai-model-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-model-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><span><GearSix weight="fill" /></span><div><h2 id="ai-model-dialog-title">模型设置</h2><p>管理模型服务配置；当前会话使用的模型请在聊天输入框中选择</p></div><button type="button" aria-label="关闭模型设置" onClick={onClose}><X /></button></header>
      <div className="ai-model-dialog-body">
        <aside>
          <div className="ai-model-list-title"><div><strong>已添加模型</strong><small>{models.length} 个配置</small></div><button type="button" onClick={startAdding}><Plus />新增</button></div>
          <div className="ai-model-list">{models.map((item) => <article className={`ai-model-list-item${form.id === item.id ? ' editing' : ''}`} key={item.id}>
            <button type="button" className="ai-model-select" onClick={() => edit(item)}><span>{item.name}</span><small>{item.model}</small>{item.id === selectedModelId && <em>当前会话</em>}</button>
            <div className="ai-model-item-actions"><button type="button" title="编辑模型" onClick={() => edit(item)}><PencilSimple /></button><button type="button" title="删除模型" onClick={() => void remove(item)}><Trash /></button></div>
          </article>)}</div>
        </aside>
        <main>
          <div className="ai-model-form-heading"><div><strong>{form.id ? '编辑模型配置' : '新增模型配置'}</strong><small>{form.id ? `正在编辑：${form.name}` : '选择服务类型并填写连接信息'}</small></div>{form.id && <button type="button" onClick={startAdding}><Plus />新增配置</button>}</div>

          <div className="ai-provider-cards" role="radiogroup" aria-label="模型接口类型">{PROVIDERS.map((provider) => <button type="button" role="radio" aria-checked={form.provider === provider.value} className={form.provider === provider.value ? 'selected' : ''} onClick={() => chooseProvider(provider.value)} key={provider.value}>
            <span>{provider.value === 'ollama' ? <HardDrives /> : <Cloud />}</span><strong>{provider.label}</strong><small>{provider.description}</small>{form.provider === provider.value && <i><Check weight="bold" /></i>}
          </button>)}</div>

          <div className="ai-model-fields">
            <label className="full">配置名称<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如：公司 OpenAI" /></label>
            <label>接口地址<input value={form.endpoint} onChange={(event) => setForm((current) => ({ ...current, endpoint: event.target.value }))} placeholder="https://api.example.com/v1" /></label>
            <label>模型名称<input value={form.model} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))} placeholder="例如：gpt-5.6-sol" /></label>
            <label className="full">API Key<div className="ai-model-key-input"><input type="password" value={form.apiKey ?? ''} disabled={form.provider === 'ollama'} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder={form.provider === 'ollama' ? '本地模型无需填写' : hasStoredKey ? '已安全保存，留空表示不修改' : '使用系统安全存储加密保存'} />{hasStoredKey && form.provider !== 'ollama' && <span><Check />已保存</span>}</div></label>
          </div>

          <div className="ai-model-form-footer">{notice ? <p className={`ai-model-form-notice ${notice.type}`}>{notice.text}</p> : <p>API Key 仅加密保存在当前设备，不会回显到页面。</p>}<button type="button" className="save-button" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : form.id ? '保存修改' : '添加模型'}</button></div>
        </main>
      </div>
    </section>
  </div>
}

export default AiModelSettingsDialog
