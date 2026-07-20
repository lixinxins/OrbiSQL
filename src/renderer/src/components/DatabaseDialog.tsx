import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Database, X } from '@phosphor-icons/react'
import type { DatabaseCharset, DatabaseConnection, DatabaseItem } from '../../../shared/connections'
import SearchableSelect from './SearchableSelect'

interface DatabaseDialogProps {
  connection: DatabaseConnection
  database?: DatabaseItem | null
  onClose: () => void
  onSaved: () => void
}

function DatabaseDialog({ connection, database, onClose, onSaved }: DatabaseDialogProps) {
  const editing = Boolean(database)
  const [name, setName] = useState(database?.name ?? '')
  const [charsets, setCharsets] = useState<DatabaseCharset[]>([])
  const [charset, setCharset] = useState(database?.charset ?? '')
  const [collation, setCollation] = useState(database?.collation ?? '')
  const [loadingCharsets, setLoadingCharsets] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void window.omnidb.databases.listCharsets(connection.id).then((result) => {
      if (!active) return
      setLoadingCharsets(false)
      if (!result.success || !result.charsets?.length) {
        setError(result.message || '没有读取到可用字符集')
        return
      }
      setCharsets(result.charsets)
      const selected = result.charsets.find((item) => item.name === database?.charset)
        ?? result.charsets.find((item) => item.name === 'utf8mb4')
        ?? result.charsets[0]
      setCharset(selected.name)
      setCollation(
        database?.collation && selected.collations.includes(database.collation)
          ? database.collation
          : selected.defaultCollation
      )
    })
    return () => { active = false }
  }, [connection.id, database?.charset, database?.collation])

  const selectedCharset = charsets.find((item) => item.name === charset)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const base = { connectionId: connection.id, name, charset, collation }
      const result = database
        ? await window.omnidb.databases.update({ ...base, currentName: database.name })
        : await window.omnidb.databases.create(base)
      if (result.success) onSaved()
      else setError(result.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="connection-dialog database-dialog" onSubmit={submit}>
        <div className="dialog-header">
          <span className="dialog-icon"><Database weight="fill" /></span>
          <div><h2>{editing ? '编辑数据库' : '新建数据库'}</h2><p>{connection.name} · {connection.engine}</p></div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭"><X /></button>
        </div>
        <div className="dialog-body">
          <label className="form-field">
            <span>数据库名称</span>
            <input autoFocus={!editing} value={name} disabled={editing} onChange={(event) => setName(event.target.value)} placeholder="请输入数据库名称" />
          </label>
          <label className="form-field">
            <span>字符集</span>
            <SearchableSelect
              disabled={loadingCharsets || charsets.length === 0}
              value={charset}
              placeholder={loadingCharsets ? '正在读取字符集…' : '搜索字符集'}
              options={charsets.map((option) => ({
                value: option.name,
                label: `${option.name} — ${option.description}`,
                keywords: option.description
              }))}
              onChange={(nextCharset) => {
              setCharset(nextCharset)
              const nextOption = charsets.find((item) => item.name === nextCharset)
              setCollation(nextOption?.defaultCollation ?? '')
              }}
            />
          </label>
          <label className="form-field">
            <span>排序规则</span>
            <SearchableSelect
              disabled={loadingCharsets || !selectedCharset}
              value={collation}
              placeholder="搜索排序规则"
              options={(selectedCharset?.collations ?? []).map((option) => ({ value: option, label: option }))}
              onChange={setCollation}
            />
          </label>
          {error && <div className="form-feedback error">{error}</div>}
        </div>
        <div className="dialog-footer">
          <span className="dialog-footer-spacer" />
          <button type="button" className="cancel-button" onClick={onClose}>取消</button>
          <button type="submit" className="save-button" disabled={saving || loadingCharsets || !charset || !collation}>{saving ? '正在保存…' : editing ? '保存修改' : '创建数据库'}</button>
        </div>
      </form>
    </div>
  )
}

export default DatabaseDialog
