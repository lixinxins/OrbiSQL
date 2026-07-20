import { useEffect, useRef } from 'react'
import { PencilSimple, X } from '@phosphor-icons/react'

interface RenameTableDialogProps {
  databaseName: string
  currentName: string
  name: string
  saving: boolean
  error: string
  onNameChange: (name: string) => void
  onCancel: () => void
  onSave: () => void
}

function RenameTableDialog({
  databaseName,
  currentName,
  name,
  saving,
  error,
  onNameChange,
  onCancel,
  onSave
}: RenameTableDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onCancel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onCancel, saving])

  const validEnglishName = /^[A-Za-z][A-Za-z0-9_]*$/.test(name)
  const canSave = validEnglishName && name !== currentName

  return (
    <div className="save-query-backdrop" onMouseDown={() => !saving && onCancel()}>
      <section className="save-query-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-table-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="save-query-dialog-icon"><PencilSimple weight="fill" /></span>
          <div><h2 id="rename-table-title">编辑表名称</h2><p>数据库“{databaseName}” · 当前名称“{currentName}”</p></div>
          <button type="button" aria-label="关闭" disabled={saving} onClick={onCancel}><X /></button>
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
              placeholder="请输入英文表名称"
              onChange={(event) => onNameChange(event.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSave && !saving) onSave()
              }}
            />
          </label>
          <p className={error ? 'save-query-dialog-error visible' : 'save-query-dialog-error'}>{error || '名称须以英文字母开头，只能包含英文字母、数字和下划线。'}</p>
        </div>
        <footer>
          <button type="button" className="save-query-cancel" disabled={saving} onClick={onCancel}>取消</button>
          <button type="button" className="save-query-submit" disabled={saving || !canSave} onClick={onSave}><PencilSimple />{saving ? '保存中…' : '保存'}</button>
        </footer>
      </section>
    </div>
  )
}

export default RenameTableDialog
