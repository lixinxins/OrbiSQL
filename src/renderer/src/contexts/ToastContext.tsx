import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle, WarningCircle, X, Info, XCircle } from '@phosphor-icons/react'

// ── Types ──────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastMessage {
  id: number
  type: ToastType
  message: string
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string) => void
}

const noop = (): void => {}

const ToastContext = createContext<ToastContextValue>({ showToast: noop })

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}

// ── Hook (状态提升到 Provider 外部) ────────────────────────

let nextId = 0

export function useToastState(): {
  toasts: ToastMessage[]
  showToast: (type: ToastType, message: string) => void
  dismissToast: (id: number) => void
} {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const showToast = useCallback((type: ToastType, message: string): void => {
    const id = ++nextId
    setToasts((prev) => [...prev, { id, type, message }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }, [])

  const dismissToast = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, showToast, dismissToast }
}

// ── Container (纯渲染) ─────────────────────────────────────

const iconMap = {
  success: <CheckCircle weight="fill" />,
  error: <XCircle weight="fill" />,
  info: <Info weight="fill" />,
  warning: <WarningCircle weight="fill" />
}

export function ToastContainer({ toasts, dismiss }: { toasts: ToastMessage[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-item toast-${toast.type}`}>
          <span className="toast-icon">{iconMap[toast.type]}</span>
          <span className="toast-message">{toast.message}</span>
          <button type="button" className="toast-dismiss" onClick={() => dismiss(toast.id)}><X /></button>
        </div>
      ))}
    </div>
  )
}

// ── Provider (用于子组件通过 useToast 访问) ─────────────────

export function ToastProvider({ children, showToast }: { children: ReactNode; showToast: (type: ToastType, message: string) => void }) {
  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
    </ToastContext.Provider>
  )
}
