import { useEffect, useRef } from 'react'
import { FloppyDisk, X } from '@phosphor-icons/react'

interface SaveQueryDialogProps {
  databaseName: string
  name: string
  saving: boolean
  error: string
  onNameChange: (name: string) => void
  onCancel: () => void
  onSave: () => void
}

function SaveQueryDialog({ databaseName, name, saving, error, onNameChange, onCancel, onSave }: SaveQueryDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onCancel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onCancel, saving])

  return (
    <div className="save-query-backdrop" onMouseDown={() => !saving && onCancel()}>
      <section className="save-query-dialog" role="dialog" aria-modal="true" aria-labelledby="save-query-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="save-query-dialog-icon"><FloppyDisk weight="fill" /></span>
          <div><h2 id="save-query-title">保存查询语句</h2><p>保存到数据库“{databaseName}”</p></div>
          <button type="button" aria-label="关闭" disabled={saving} onClick={onCancel}><X /></button>
        </header>
        <div className="save-query-dialog-body">
          <label>
            查询名称
            <input
              ref={inputRef}
              value={name}
              maxLength={80}
              placeholder="例如：今日新增用户"
              onChange={(event) => onNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim() && !saving) onSave()
              }}
            />
          </label>
          <p className={error ? 'save-query-dialog-error visible' : 'save-query-dialog-error'}>{error || '同名查询再次保存时会更新原有内容。'}</p>
        </div>
        <footer>
          <button type="button" className="save-query-cancel" disabled={saving} onClick={onCancel}>取消</button>
          <button type="button" className="save-query-submit" disabled={saving || !name.trim()} onClick={onSave}><FloppyDisk />{saving ? '保存中…' : '保存'}</button>
        </footer>
      </section>
    </div>
  )
}

export default SaveQueryDialog
