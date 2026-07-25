import { useState } from 'react'
import type { FormEvent } from 'react'
import { FolderOpen, HardDrives, TerminalWindow, X } from '@phosphor-icons/react'

interface Props {
  onClose: () => void
  onCreated: () => void
  defaultCategory?: 'database' | 'ssh'
}

function ConnectionGroupDialog({ onClose, onCreated, defaultCategory = 'database' }: Props) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<'database' | 'ssh'>(defaultCategory)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await window.omnidb.connections.createGroup(name.trim(), category)
      if (!result.success) {
        setError(result.message)
        return
      }
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="dialog-backdrop connection-group-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
    >
      <form className="connection-group-dialog" onSubmit={(event) => void submit(event)}>
        <header>
          <span>
            <FolderOpen weight="fill" />
          </span>
          <div>
            <h2>新建连接分组</h2>
            <p>创建后可在对应的连接类型下归类与筛选</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="关闭">
            <X />
          </button>
        </header>
        <div className="connection-group-dialog-body">
          <label>
            <span>分组类型</span>
            <div className="group-category-picker">
              <button
                type="button"
                className={`group-category-btn${category === 'database' ? ' active' : ''}`}
                onClick={() => setCategory('database')}
              >
                <HardDrives weight="fill" />
                <span>数据库连接分组</span>
              </button>
              <button
                type="button"
                className={`group-category-btn ssh${category === 'ssh' ? ' active' : ''}`}
                onClick={() => setCategory('ssh')}
              >
                <TerminalWindow weight="fill" />
                <span>SSH 客户端分组</span>
              </button>
            </div>
          </label>

          <label>
            <span>分组名称</span>
            <input
              autoFocus
              maxLength={30}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError('')
              }}
              placeholder={category === 'database' ? '例如：生产环境数据库' : '例如：跳板机服务器群'}
            />
          </label>
          <p className={error ? 'visible' : ''}>{error || '最多输入 30 个字符'}</p>
        </div>
        <footer>
          <button type="button" className="cancel-button" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button type="submit" className="save-button" disabled={!name.trim() || saving}>
            {saving ? '正在创建…' : '创建分组'}
          </button>
        </footer>
      </form>
    </div>
  )
}

export default ConnectionGroupDialog
