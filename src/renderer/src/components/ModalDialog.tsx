import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

interface ModalDialogProps {
  title: string
  onClose: () => void
  wide?: boolean
  children: ReactNode
}

const FOCUSABLE = 'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function ModalDialog({ title, onClose, wide = false, children }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const first = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea')
    ;(first ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (item) => !item.hasAttribute('disabled')
    )
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={`dialog${wide ? ' dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2 className="dialog__title">{title}</h2>
        {children}
      </div>
    </div>
  )
}
