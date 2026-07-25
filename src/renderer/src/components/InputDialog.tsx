import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PencilSimple, X } from '@phosphor-icons/react'

// ── Types ──────────────────────────────────────────────────

export interface InputDialogOptions {
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
}

interface PendingInput extends InputDialogOptions {
  resolve: (value: string | null) => void
}

// ── Dialog ─────────────────────────────────────────────────

function InputDialog({ request, onFinish }: { request: PendingInput; onFinish: (value: string | null) => void }) {
  const [value, setValue] = useState(request.defaultValue ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.select(), 50)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onFinish(null)
      if (event.key === 'Enter') onFinish(value.trim())
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onFinish, value])

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={() => onFinish(null)}>
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="input-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="confirm-dialog-close" aria-label="关闭" onClick={() => onFinish(null)}><X /></button>
        <div className="confirm-dialog-icon"><PencilSimple weight="fill" /></div>
        <div className="confirm-dialog-copy">
          <h2 id="input-dialog-title">{request.title}</h2>
          {request.message && <p className="confirm-dialog-message">{request.message}</p>}
        </div>
        <div style={{ padding: '0 24px 12px' }}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={request.placeholder}
            className="input-dialog-field"
            autoFocus
          />
        </div>
        <footer className="confirm-dialog-actions">
          <button type="button" className="confirm-dialog-cancel" onClick={() => onFinish(null)}>取消</button>
          <button type="button" className="confirm-dialog-danger" style={{ background: 'var(--primary)', borderColor: 'var(--primary)' }} onClick={() => onFinish(value.trim())}>{request.confirmLabel ?? '确认'}</button>
        </footer>
      </section>
    </div>
  )
}

// ── Hook ───────────────────────────────────────────────────

export function useInputDialog(): {
  showInputDialog: (options: InputDialogOptions) => Promise<string | null>
  inputDialog: ReactNode
} {
  const [request, setRequest] = useState<PendingInput | null>(null)

  const showInputDialog = useCallback((options: InputDialogOptions): Promise<string | null> => new Promise((resolve) => {
    setRequest((current) => {
      current?.resolve(null)
      return { ...options, resolve }
    })
  }), [])

  const finish = useCallback((value: string | null): void => {
    setRequest((current) => {
      current?.resolve(value)
      return null
    })
  }, [])

  return {
    showInputDialog,
    inputDialog: request ? <InputDialog request={request} onFinish={finish} /> : null
  }
}
