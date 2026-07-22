import { useState } from 'react'
import type { FormEvent } from 'react'
import { FolderOpen, X } from '@phosphor-icons/react'

interface Props {
  onClose: () => void
  onCreated: () => void
}

function ConnectionGroupDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true); setError('')
    try {
      const result = await window.omnidb.connections.createGroup(name.trim())
      if (!result.success) { setError(result.message); return }
      onCreated()
    } finally { setSaving(false) }
  }

  return <div className="dialog-backdrop connection-group-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <form className="connection-group-dialog" onSubmit={(event) => void submit(event)}>
      <header><span><FolderOpen weight="fill" /></span><div><h2>新建连接分组</h2><p>创建后可在新建连接或连接右键菜单中选择</p></div><button type="button" onClick={onClose} disabled={saving} aria-label="关闭"><X /></button></header>
      <div className="connection-group-dialog-body"><label><span>分组名称</span><input autoFocus maxLength={30} value={name} onChange={(event) => { setName(event.target.value); setError('') }} placeholder="例如：生产环境" /></label><p className={error ? 'visible' : ''}>{error || '最多输入 30 个字符'}</p></div>
      <footer><button type="button" className="cancel-button" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="save-button" disabled={!name.trim() || saving}>{saving ? '正在创建…' : '创建分组'}</button></footer>
    </form>
  </div>
}

export default ConnectionGroupDialog
