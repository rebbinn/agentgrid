import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ShellInfo } from '@shared/ipc'
import { useLaunch } from '../hooks/use-launch'
import { getShells } from '../lib/shells'
import { strings } from '../strings'
import { Icon } from './Icon'

export function NewTerminalButton() {
  const launch = useLaunch()
  const [open, setOpen] = useState(false)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getShells()
      .then(setShells)
      .catch(() => setShells([]))
  }, [])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    )
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.stopPropagation()
      setOpen(false)
      rootRef.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    }
  }

  const launchWithShell = (shellId: string): void => {
    setOpen(false)
    void launch({ shellId })
  }

  return (
    <div className="split-button" ref={rootRef}>
      <button
        type="button"
        className="btn btn--primary split-button__main"
        onClick={() => void launch()}
      >
        <Icon name="plus" />
        {strings.header.newTerminal}
      </button>
      <button
        type="button"
        className="btn btn--primary split-button__toggle"
        aria-label={strings.header.chooseShell}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div
          className="menu"
          role="menu"
          aria-label={strings.header.chooseShell}
          ref={menuRef}
          onKeyDown={handleMenuKeyDown}
        >
          {shells.map((shell) => (
            <button
              key={shell.id}
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => launchWithShell(shell.id)}
            >
              {shell.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
