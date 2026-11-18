import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { DropdownItem } from './Dropdown'

interface ContextMenuProps {
  x: number
  y: number
  label: string
  items: DropdownItem[]
  onClose: () => void
}

const EDGE_GAP = 8

export function ContextMenu({ x, y, label, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(EDGE_GAP, Math.min(x, window.innerWidth - width - EDGE_GAP)),
      top: Math.max(EDGE_GAP, Math.min(y, window.innerHeight - height - EDGE_GAP))
    })
  }, [x, y])

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus()
    const closeOnOutside = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const closeNow = (): void => onClose()
    document.addEventListener('mousedown', closeOnOutside)
    window.addEventListener('resize', closeNow)
    window.addEventListener('blur', closeNow)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      window.removeEventListener('resize', closeNow)
      window.removeEventListener('blur', closeNow)
    }
  }, [onClose])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const elements = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []
    )
    const index = elements.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      elements[(index + 1) % elements.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      elements[(index - 1 + elements.length) % elements.length]?.focus()
    }
  }

  return (
    <div
      ref={menuRef}
      className="menu menu--context"
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => (
        <div key={item.id} className="menu__group">
          {item.separatorBefore && <div className="menu__separator" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={`menu__item${item.id === 'delete' ? ' menu__item--danger' : ''}`}
            aria-disabled={item.disabled ? true : undefined}
            onClick={() => {
              if (item.disabled) return
              onClose()
              item.onSelect()
            }}
          >
            {item.icon && <span className="menu__icon">{item.icon}</span>}
            <span className="menu__label">{item.label}</span>
            {item.hint && <span className="menu__hint">{item.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  )
}
