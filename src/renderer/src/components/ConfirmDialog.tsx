import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { WarningCircle, X } from '@phosphor-icons/react'

export interface ConfirmDialogOptions {
  title: string
  message: string
  detail: string
  confirmLabel?: string
}

interface PendingConfirmation extends ConfirmDialogOptions {
  resolve: (confirmed: boolean) => void
}

function ConfirmDialog({ request, onFinish }: { request: PendingConfirmation; onFinish: (confirmed: boolean) => void }) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelButtonRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onFinish(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onFinish])

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={() => onFinish(false)}>
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="confirm-dialog-close" aria-label="关闭确认窗口" onClick={() => onFinish(false)}><X /></button>
        <div className="confirm-dialog-icon"><WarningCircle weight="fill" /></div>
        <div className="confirm-dialog-copy">
          <h2 id="confirm-dialog-title">{request.title}</h2>
          <p className="confirm-dialog-message">{request.message}</p>
          <p id="confirm-dialog-description" className="confirm-dialog-detail">{request.detail}</p>
        </div>
        <footer className="confirm-dialog-actions">
          <button type="button" ref={cancelButtonRef} className="confirm-dialog-cancel" onClick={() => onFinish(false)}>取消</button>
          <button type="button" className="confirm-dialog-danger" onClick={() => onFinish(true)}>{request.confirmLabel ?? '确认删除'}</button>
        </footer>
      </section>
    </div>
  )
}

export function useConfirmDialog(): {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>
  confirmDialog: ReactNode
} {
  const [request, setRequest] = useState<PendingConfirmation | null>(null)

  const confirm = useCallback((options: ConfirmDialogOptions): Promise<boolean> => new Promise((resolve) => {
    setRequest((current) => {
      current?.resolve(false)
      return { ...options, resolve }
    })
  }), [])

  const finish = useCallback((confirmed: boolean): void => {
    setRequest((current) => {
      current?.resolve(confirmed)
      return null
    })
  }, [])

  useEffect(() => () => {
    request?.resolve(false)
  }, [request])

  return {
    confirm,
    confirmDialog: request ? <ConfirmDialog request={request} onFinish={finish} /> : null
  }
}
