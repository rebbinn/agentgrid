import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface DropdownItem {
  id: string
  label: string
  hint?: string
  icon?: ReactNode
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'
  checked?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

interface DropdownProps {
  label: string
  items: DropdownItem[]
  buttonClassName: string
  children: ReactNode
  align?: 'left' | 'right'
  tip?: string
  onOpen?: () => void
}

export function Dropdown({
  label,
  items,
  buttonClassName,
  children,
  align = 'right',
  tip,
  onOpen
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus()
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const focusableItems = (): HTMLElement[] =>
    Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []
    )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const elements = focusableItems()
    const index = elements.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      elements[(index + 1) % elements.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      elements[(index - 1 + elements.length) % elements.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      elements[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      elements[elements.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const select = (item: DropdownItem): void => {
    if (item.disabled) return
    setOpen(false)
    item.onSelect()
  }

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tip={open ? undefined : tip}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen((value) => !value)
        }}
      >
        {children}
      </button>
      {open && (
        <div
          className={`menu menu--${align}`}
          role="menu"
          aria-label={label}
          ref={menuRef}
          onKeyDown={handleKeyDown}
        >
          {items.map((item) => {
            const role = item.role ?? 'menuitem'
            return (
              <div key={item.id} className="menu__group">
                {item.separatorBefore && <div className="menu__separator" role="separator" />}
                <button
                  type="button"
                  role={role}
                  className="menu__item"
                  aria-checked={role === 'menuitem' ? undefined : Boolean(item.checked)}
                  aria-disabled={item.disabled ? true : undefined}
                  onClick={() => select(item)}
                >
                  {item.icon && <span className="menu__icon">{item.icon}</span>}
                  <span className="menu__label">{item.label}</span>
                  {item.hint && <span className="menu__hint">{item.hint}</span>}
                  {role !== 'menuitem' && (
                    <span className="menu__check" aria-hidden="true">
                      {item.checked ? '✓' : ''}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
