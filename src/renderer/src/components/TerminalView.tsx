import { useEffect, useRef } from 'react'
import { useTerminalStore } from '../state/terminal-store'
import type { TerminalSize } from '../terminal/managed-terminal'
import { terminalRegistry } from '../terminal/registry'

interface TerminalViewProps {
  id: string
  active: boolean
}

export function TerminalView({ id, active }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const managed = terminalRegistry.get(id)
    if (!container || !managed) return

    const spawnOnce = (size: TerminalSize | null): void => {
      if (!size || managed.spawnRequested) return
      managed.spawnRequested = true
      void useTerminalStore.getState().spawnPane(id, size.cols, size.rows)
    }

    managed.attach(container)
    spawnOnce(managed.fit())

    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => spawnOnce(managed.fit()))
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      managed.detach()
    }
  }, [id])

  useEffect(() => {
    if (active) terminalRegistry.get(id)?.focus()
  }, [active, id])

  return <div ref={containerRef} className="terminal-view" />
}
