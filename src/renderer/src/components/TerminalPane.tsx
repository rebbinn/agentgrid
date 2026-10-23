import { memo, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useClosePane } from '../hooks/use-close-pane'
import { folderName } from '../lib/path'
import { useTerminalStore, MAX_TITLE_LENGTH, type Pane } from '../state/terminal-store'
import { strings } from '../strings'
import { terminalRegistry } from '../terminal/registry'
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../terminal/theme'
import { Dropdown, type DropdownItem } from './Dropdown'
import { Icon } from './Icon'
import { TerminalView } from './TerminalView'

const DRAG_TYPE = 'application/x-agentgrid-pane'

interface TerminalPaneProps {
  pane: Pane
  active: boolean
  column: number
  row: number
  focusMode: boolean
  hidden: boolean
}

function TerminalPaneComponent({ pane, active, column, row, focusMode, hidden }: TerminalPaneProps) {
  const closePane = useClosePane()
  const [renaming, setRenaming] = useState(false)
  const [dropTarget, setDropTarget] = useState(false)

  useEffect(() => {
    terminalRegistry.get(pane.id)?.setFontSize(pane.fontSize)
  }, [pane.id, pane.fontSize])

  const store = useTerminalStore.getState
  const activate = (): void => store().setActive(pane.id)
  const restart = (): void => void store().restart(pane.id)
  const focusTerminal = (): void => terminalRegistry.get(pane.id)?.focus()

  const renameFinished = useRef(false)

  const finishRename = (value: string | null): void => {
    if (renameFinished.current) return
    renameFinished.current = true
    if (value !== null) store().renamePane(pane.id, value)
    setRenaming(false)
    focusTerminal()
  }

  const startRename = (): void => {
    renameFinished.current = false
    setRenaming(true)
  }

  const handleRenameKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') finishRename(event.currentTarget.value)
    else if (event.key === 'Escape') finishRename(null)
  }

  const handleDragStart = (event: DragEvent<HTMLElement>): void => {
    event.dataTransfer.setData(DRAG_TYPE, pane.id)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(true)
  }

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    const draggedId = event.dataTransfer.getData(DRAG_TYPE)
    setDropTarget(false)
    if (!draggedId) return
    event.preventDefault()
    store().swapPanes(draggedId, pane.id)
  }

  const menuItems: DropdownItem[] = [
    { id: 'rename', label: strings.pane.rename, onSelect: startRename },
    { id: 'restart', label: strings.terminal.restart, onSelect: restart },
    {
      id: 'clear',
      label: strings.terminal.clear,
      onSelect: () => {
        store().clear(pane.id)
        focusTerminal()
      }
    },
    {
      id: 'earlier',
      label: strings.pane.moveEarlier,
      separatorBefore: true,
      onSelect: () => store().movePane(pane.id, -1)
    },
    { id: 'later', label: strings.pane.moveLater, onSelect: () => store().movePane(pane.id, 1) },
    {
      id: 'larger',
      label: strings.pane.fontLarger,
      hint: 'Ctrl +',
      separatorBefore: true,
      disabled: pane.fontSize >= MAX_FONT_SIZE,
      onSelect: () => {
        store().adjustFontSize(pane.id, 1)
        focusTerminal()
      }
    },
    {
      id: 'smaller',
      label: strings.pane.fontSmaller,
      hint: 'Ctrl −',
      disabled: pane.fontSize <= MIN_FONT_SIZE,
      onSelect: () => {
        store().adjustFontSize(pane.id, -1)
        focusTerminal()
      }
    },
    {
      id: 'reset-font',
      label: strings.pane.fontReset,
      hint: strings.pane.fontSize(pane.fontSize),
      onSelect: () => {
        store().resetFontSize(pane.id)
        focusTerminal()
      }
    }
  ]

  return (
    <section
      className="pane"
      data-active={active}
      data-status={pane.status}
      data-drop-target={dropTarget}
      style={hidden ? { display: 'none' } : { gridColumn: column, gridRow: row }}
      aria-label={strings.terminal.paneLabel(pane.title)}
      onMouseDown={activate}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropTarget(false)}
      onDrop={handleDrop}
    >
      <header
        className="pane__header"
        draggable={!renaming && !focusMode}
        onDragStart={handleDragStart}
        onDoubleClick={() => store().toggleFocus(pane.id)}
      >
        <span
          className={`dot dot--${pane.status}`}
          role="img"
          aria-label={strings.terminal.states[pane.status]}
          title={strings.terminal.states[pane.status]}
        />
        {renaming ? (
          <input
            className="pane__rename"
            aria-label={strings.pane.renameLabel}
            defaultValue={pane.title}
            maxLength={MAX_TITLE_LENGTH}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => finishRename(event.currentTarget.value)}
            onKeyDown={handleRenameKey}
            onDoubleClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span
            className="pane__title"
            onDoubleClick={(event) => {
              event.stopPropagation()
              startRename()
            }}
          >
            {pane.title}
          </span>
        )}
        <span className="pane__meta" title={pane.cwd}>
          {pane.shellLabel} · {folderName(pane.cwd)}
        </span>
        <span className="pane__spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label={focusMode ? strings.pane.restore : strings.pane.maximize}
          data-tip={focusMode ? strings.pane.restore : strings.pane.maximize}
          onClick={() => store().toggleFocus(pane.id)}
        >
          <Icon name={focusMode ? 'restore' : 'maximize'} size={14} />
        </button>
        <Dropdown label={strings.pane.menu} items={menuItems} buttonClassName="icon-button">
          <Icon name="more" size={14} />
        </Dropdown>
        <button
          type="button"
          className="icon-button"
          aria-label={strings.terminal.close}
          data-tip={strings.terminal.close}
          onClick={() => closePane(pane.id)}
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="pane__body">
        <TerminalView id={pane.id} active={active && !renaming} />

        {pane.status === 'error' && pane.errorCode && (
          <div className="pane__overlay" role="alert">
            <h2 className="pane__overlay-title">{strings.terminal.errorTitle}</h2>
            <p className="pane__overlay-text">
              {strings.terminal.errorText(pane.errorCode, pane.errorDetail ?? '')}
            </p>
            <div className="empty-state__actions">
              <button type="button" className="btn btn--primary" onClick={restart}>
                <Icon name="restart" />
                {strings.terminal.retry}
              </button>
              <button type="button" className="btn" onClick={() => closePane(pane.id)}>
                {strings.terminal.close}
              </button>
            </div>
          </div>
        )}
      </div>

      {pane.status === 'exited' && (
        <footer className="pane__footer">
          <span>{strings.terminal.exitedBar(pane.exitCode ?? 0)}</span>
          <button type="button" className="btn" onClick={restart}>
            <Icon name="restart" />
            {strings.terminal.restart}
          </button>
        </footer>
      )}
    </section>
  )
}

export const TerminalPane = memo(TerminalPaneComponent)
