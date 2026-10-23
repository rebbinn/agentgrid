import { useEffect } from 'react'
import { useUiStore, type Toast } from '../state/ui-store'
import { strings } from '../strings'
import { Icon } from './Icon'

const AUTO_DISMISS_MS = 4500

function ToastItem({ toast }: { toast: Toast }) {
  const dismissToast = useUiStore((state) => state.dismissToast)

  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [toast.id, dismissToast])

  return (
    <div className={`toast toast--${toast.kind}`}>
      <span className="toast__message">{toast.message}</span>
      <button
        type="button"
        className="toast__close"
        aria-label={strings.toast.dismiss}
        onClick={() => dismissToast(toast.id)}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

export function Toasts() {
  const toasts = useUiStore((state) => state.toasts)

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
