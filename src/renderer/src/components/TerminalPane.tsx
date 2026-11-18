import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { findAgent } from '@shared/agents'
import { endpointLabel } from '@shared/hosts'
import { useClosePane } from '../hooks/use-close-pane'
import { folderName } from '../lib/path'
import { withShortcut } from '../lib/shortcuts'
import { useHostsStore } from '../state/hosts-store'
import { useSshStore } from '../state/ssh-store'
import { remoteHostId, useTerminalStore, MAX_TITLE_LENGTH, type Pane } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { terminalRegistry } from '../terminal/registry'
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../terminal/theme'
import { Dropdown, type DropdownItem } from './Dropdown'
import { EnvironmentBadge } from './EnvironmentBadge'
import { Icon } from './Icon'
import { SftpView } from './SftpView'
import { SshPaneOverlay, sshFooterText } from './SshPaneOverlay'
import { TerminalView } from './TerminalView'

const DRAG_TYPE = 'application/x-agentgrid-pane'

function describeCommand(pane: Pane): string {
  if (pane.startupCommand) return pane.startupCommand
  if (!pane.agentId) return ''
  const command = findAgent(pane.agentId).command
  return pane.resumeSessionId ? `${command} --resume …` : command
}

interface TerminalPaneProps {
  pane: Pane
  active: boolean
  column: number
  columnSpan: number
  row: number
  focusMode: boolean
  hidden: boolean
}

function TerminalPaneComponent({
  pane,
  active,
  column,
  columnSpan,
  row,
  focusMode,
  hidden
}: TerminalPaneProps) {
  const closePane = useClosePane()
  const hostId = remoteHostId(pane)
  const host = useHostsStore((state) =>
    hostId ? state.views.find((view) => view.host.id === hostId)?.host : undefined
  )
  const latency = useSshStore((state) => state.latency[pane.id])
  const isSsh = hostId !== undefined
  const isSftp = pane.sftpHostId !== undefined
  const [renaming, setRenaming] = useState(false)
  const [dropTarget, setDropTarget] = useState(false)

  useEffect(() => {
    terminalRegistry.get(pane.id)?.setFontSize(pane.fontSize)
  }, [pane.id, pane.fontSize])

  const store = useTerminalStore.getState
  const renamingRef = useRef(false)
  const activate = (event: MouseEvent<HTMLElement>): void => {
    store().setActive(pane.id)
    const target = event.target as HTMLElement
    if (target.closest('button, input, [role="menu"], [role="menuitem"]')) return
    const section = event.currentTarget
    window.setTimeout(() => {
      if (renamingRef.current) return
      const focused = document.activeElement
      const someoneElseHasFocus = focused !== null && focused !== document.body && !section.contains(focused)
      if (!someoneElseHasFocus) terminalRegistry.get(pane.id)?.focus()
    }, 0)
  }
  const restart = (): void => void store().restart(pane.id)
  const focusTerminal = (): void => terminalRegistry.get(pane.id)?.focus()

  const renameFinished = useRef(false)

  const finishRename = (value: string | null): void => {
    if (renameFinished.current) return
    renameFinished.current = true
    renamingRef.current = false
    if (value !== null) store().renamePane(pane.id, value)
    setRenaming(false)
    focusTerminal()
  }

  const startRename = useCallback((): void => {
    renameFinished.current = false
    renamingRef.current = true
    setRenaming(true)
  }, [])

  const renameRequestId = useUiStore((state) => state.renameRequestId)
  useEffect(() => {
    if (renameRequestId !== pane.id) return
    useUiStore.getState().clearRenameRequest()
    startRename()
  }, [renameRequestId, pane.id, startRename])

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

  const sftpMenu: DropdownItem[] = [
    { id: 'rename', label: strings.pane.rename, onSelect: startRename },
    { id: 'restart', label: strings.ssh.reconnect, onSelect: restart },
    {
      id: 'earlier',
      label: strings.pane.moveEarlier,
      separatorBefore: true,
      onSelect: () => store().movePane(pane.id, -1)
    },
    { id: 'later', label: strings.pane.moveLater, onSelect: () => store().movePane(pane.id, 1) }
  ]

  const terminalMenu: DropdownItem[] = [
    { id: 'rename', label: strings.pane.rename, onSelect: startRename },
    { id: 'restart', label: isSsh ? strings.ssh.reconnect : strings.terminal.restart, onSelect: restart },
    ...(isSsh && host
      ? [{ id: 'sftp', label: strings.sftp.openFromPane, onSelect: () => store().launchSftp(host.id, pane.id) }]
      : []),
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
      data-env={host?.environment ?? undefined}
      data-kind={isSftp ? 'sftp' : undefined}
      style={
        hidden
          ? { display: 'none' }
          : { gridColumn: columnSpan > 1 ? `${column} / span ${columnSpan}` : column, gridRow: row }
      }
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
        {isSsh ? (
          <>
            <span className="pane__badge">{isSftp ? strings.sftp.badge : strings.ssh.badge}</span>
            {host && (
              <span className="pane__meta" title={host.note || endpointLabel(host)}>
                {endpointLabel(host)}
              </span>
            )}
            {host?.environment && <EnvironmentBadge environment={host.environment} />}
          </>
        ) : (
          <span className="pane__meta" title={pane.cwd}>
            {pane.shellLabel} · {folderName(pane.cwd)}
          </span>
        )}
        <span className="pane__spacer" />
        {isSsh && !isSftp && pane.status === 'running' && latency !== undefined && (
          <span className="pane__latency">{strings.ssh.latency(latency)}</span>
        )}
        {isSsh && !isSftp && host && pane.status === 'running' && (
          <button
            type="button"
            className="pane__action"
            aria-label={strings.sftp.openFromPane}
            title={strings.sftp.openFromPane}
            onClick={() => store().launchSftp(host.id, pane.id)}
          >
            <Icon name="folder" size={13} />
            {strings.sftp.badge}
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={focusMode ? strings.pane.restore : strings.pane.maximize}
          data-tip={withShortcut(focusMode ? strings.pane.restore : strings.pane.maximize, 'toggleFocus')}
          onClick={() => store().toggleFocus(pane.id)}
        >
          <Icon name={focusMode ? 'restore' : 'maximize'} size={14} />
        </button>
        <Dropdown label={strings.pane.menu} items={isSftp ? sftpMenu : terminalMenu} buttonClassName="icon-button">
          <Icon name="more" size={14} />
        </Dropdown>
        <button
          type="button"
          className="icon-button"
          aria-label={strings.terminal.close}
          data-tip={withShortcut(strings.terminal.close, 'closePane')}
          onClick={() => closePane(pane.id)}
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      <div className="pane__body">
        {isSftp ? (
          pane.status === 'running' && <SftpView paneId={pane.id} host={host} />
        ) : (
          <TerminalView id={pane.id} active={active && !renaming} />
        )}

        {isSsh && <SshPaneOverlay pane={pane} host={host} onClose={() => closePane(pane.id)} />}

        {!isSsh && pane.status === 'idle' && (
          <div className="pane__overlay" role="group" aria-label={strings.restore.overlayTitle}>
            <h2 className="pane__overlay-title pane__overlay-title--info">{strings.restore.overlayTitle}</h2>
            <p className="pane__overlay-text">
              {strings.restore.overlayText(pane.shellLabel, folderName(pane.cwd))}
            </p>
            {(pane.agentId || pane.startupCommand) && (
              <p className="pane__overlay-text">
                {strings.restore.overlayCommand(describeCommand(pane))}
              </p>
            )}
            <div className="empty-state__actions">
              <button type="button" className="btn btn--primary" onClick={restart}>
                <Icon name="restart" />
                {strings.restore.start}
              </button>
              <button type="button" className="btn" onClick={() => closePane(pane.id)}>
                {strings.terminal.close}
              </button>
            </div>
          </div>
        )}

        {!isSsh && pane.status === 'error' && pane.errorCode && (
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
          <span>
            {isSftp
              ? pane.exitReason === 'lost'
                ? strings.sftp.lostBar
                : strings.sftp.closedBar
              : isSsh
                ? sshFooterText(pane)
                : strings.terminal.exitedBar(pane.exitCode ?? 0)}
          </span>
          <button type="button" className="btn" onClick={restart}>
            <Icon name="restart" />
            {isSsh ? strings.ssh.reconnect : strings.terminal.restart}
          </button>
        </footer>
      )}
    </section>
  )
}

export const TerminalPane = memo(TerminalPaneComponent)
