import { useState } from 'react'
import { WarningCircle, X } from '@phosphor-icons/react'

interface UnsavedChangesModalProps {
  tableName: string
  onSave: () => Promise<void>
  onDiscard: () => void
  onCancel: () => void
}

export default function UnsavedChangesModal({
  tableName,
  onSave,
  onDiscard,
  onCancel
}: UnsavedChangesModalProps) {
  const [saving, setSaving] = useState(false)

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      await onSave()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onMouseDown={saving ? undefined : onCancel}
    >
      <section
        className="confirm-dialog unsaved-changes-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="confirm-dialog-close"
          aria-label="关闭提示"
          disabled={saving}
          onClick={onCancel}
        >
          <X />
        </button>
        <div className="confirm-dialog-icon warning">
          <WarningCircle weight="fill" />
        </div>
        <div className="confirm-dialog-copy">
          <h2 id="unsaved-dialog-title">保存对数据表的修改？</h2>
          <p className="confirm-dialog-message">
            数据表“{tableName || '未命名'}”有尚未保存的修改。
          </p>
          <p className="confirm-dialog-detail">
            如果选择“不保存”，您在此页面中所做的全部修改都将丢失。
          </p>
        </div>
        <footer className="confirm-dialog-actions unsaved-actions">
          <button
            type="button"
            className="confirm-dialog-cancel"
            disabled={saving}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="unsaved-dialog-discard"
            disabled={saving}
            onClick={onDiscard}
          >
            不保存
          </button>
          <button
            type="button"
            className="confirm-dialog-primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? '正在保存…' : '保存并关闭'}
          </button>
        </footer>
      </section>
    </div>
  )
}
