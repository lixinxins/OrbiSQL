import { useEffect, useRef, useState } from 'react'
import { Copy, X } from '@phosphor-icons/react'
import type { DatabaseConnection, DatabaseItem, TableItem } from '@/shared/connections'
import { useConnectionStore } from '../stores/useConnectionStore'

interface CopyTableDialogProps {
  connection: DatabaseConnection
  database: DatabaseItem
  table: TableItem
  includeData: boolean
  onClose: () => void
}

function CopyTableDialog({ connection, database, table, includeData, onClose }: CopyTableDialogProps) {
  const [name, setName] = useState(`${table.name}_copy`)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const refreshConnection = useConnectionStore((s) => s.actions.refreshConnection)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, saving])

  const canSave = name.trim().length > 0 && name !== table.name

  const handleCopy = async (): Promise<void> => {
    const targetTableName = name.trim()
    if (!targetTableName || targetTableName === table.name) return
    setSaving(true)
    setError('')
    const result = await window.omnidb.tables.copy({
      connectionId: connection.id,
      databaseName: database.name,
      sourceTableName: table.name,
      targetTableName,
      includeData
    })
    setSaving(false)
    if (!result.success) {
      setError(result.message)
      return
    }
    await refreshConnection(connection.id)
    onClose()
  }

  return (
    <div className="save-query-backdrop" onMouseDown={() => !saving && onClose()}>
      <section
        className="save-query-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-table-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="save-query-dialog-icon"><Copy weight="fill" /></span>
          <div>
            <h2 id="copy-table-title">复制数据表</h2>
            <p>数据库"{database.name}" · 源表"{table.name}"{includeData ? '（含数据）' : '（仅结构）'}</p>
          </div>
          <button type="button" aria-label="关闭" disabled={saving} onClick={onClose}><X /></button>
        </header>
        <div className="save-query-dialog-body">
          <label>
            新表名称
            <input
              ref={inputRef}
              value={name}
              maxLength={128}
              spellCheck={false}
              autoCapitalize="off"
              placeholder="请输入新表名称"
              onChange={(event) => {
                setName(event.target.value)
                setError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSave && !saving) void handleCopy()
              }}
            />
          </label>
          {error && <p className="save-query-dialog-error visible">{error}</p>}
        </div>
        <footer>
          <button type="button" className="save-query-cancel" disabled={saving} onClick={onClose}>取消</button>
          <button
            type="button"
            className="save-query-submit"
            disabled={saving || !canSave}
            onClick={() => void handleCopy()}
          >
            <Copy />{saving ? '复制中…' : '复制'}
          </button>
        </footer>
      </section>
    </div>
  )
}

export default CopyTableDialog
