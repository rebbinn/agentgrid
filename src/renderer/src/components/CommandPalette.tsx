import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ShellInfo } from '@shared/ipc'
import { buildCommands, type Command } from '../commands/commands'
import { searchCommands } from '../commands/search'
import { formatShortcut } from '../lib/shortcuts'
import { getShells } from '../lib/shells'
import { useAgentsStore } from '../state/agents-store'
import { useLayoutStore } from '../state/layout-store'
import { usePresetsStore } from '../state/presets-store'
import { useSessionsStore } from '../state/sessions-store'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { useWorkspaceStore } from '../state/workspace-store'
import { strings } from '../strings'
import { terminalRegistry } from '../terminal/registry'

export function CommandPalette() {
  const open = useUiStore((state) => state.paletteOpen)
  if (!open) return null
  return <PaletteContent />
}

function PaletteContent() {
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen)
  const panes = useTerminalStore((state) => state.panes)
  const activePaneId = useTerminalStore((state) => state.activePaneId)
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeId)
  const presets = usePresetsStore((state) => state.presets)
  const agents = useAgentsStore((state) => state.status)
  const sessions = useSessionsStore((state) => state.sessions)
  const focusMode = useLayoutStore((state) => state.focusMode)
  const [shells, setShells] = useState<ShellInfo[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    getShells()
      .then(setShells)
      .catch(() => setShells([]))
    void useAgentsStore.getState().load()
    void useSessionsStore.getState().load()
  }, [])

  const commands = useMemo(
    () =>
      buildCommands({
        panes,
        activePaneId,
        workspaces,
        activeWorkspaceId,
        shells,
        presets,
        agents,
        sessions,
        focusMode
      }),
    [panes, activePaneId, workspaces, activeWorkspaceId, shells, presets, agents, sessions, focusMode]
  )
  const results = useMemo(() => searchCommands(commands, query), [commands, query])
  const current = results.length === 0 ? 0 : Math.min(selected, results.length - 1)

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [current, results])

  const close = (): void => setPaletteOpen(false)

  const run = (command: Command): void => {
    close()
    void Promise.resolve(command.run()).finally(() => {
      window.setTimeout(() => {
        if (useUiStore.getState().dialog !== null) return
        const active = useTerminalStore.getState().activePaneId
        if (active) terminalRegistry.get(active)?.focus()
      }, 0)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected(results.length === 0 ? 0 : (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected(results.length === 0 ? 0 : (current - 1 + results.length) % results.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setSelected(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setSelected(Math.max(0, results.length - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const command = results[current]
      if (command) run(command)
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={strings.palette.label}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          className="palette__input"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results.length > 0 ? `palette-option-${current}` : undefined}
          aria-label={strings.palette.label}
          placeholder={strings.palette.placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
        />
        <div ref={listRef} id="palette-list" className="palette__list" role="listbox" aria-label={strings.palette.listLabel}>
          {results.length === 0 && <p className="palette__empty">{strings.palette.empty}</p>}
          {results.map((command, index) => (
            <div
              key={command.id}
              id={`palette-option-${index}`}
              role="option"
              aria-selected={index === current}
              className="palette__item"
              onMouseMove={() => setSelected(index)}
              onClick={() => run(command)}
            >
              <span className="palette__group">{command.group}</span>
              <span className="palette__title">{command.title}</span>
              {command.shortcut && <kbd className="palette__key">{formatShortcut(command.shortcut)}</kbd>}
            </div>
          ))}
        </div>
        <p className="palette__hint">{strings.palette.hint}</p>
      </div>
    </div>
  )
}
