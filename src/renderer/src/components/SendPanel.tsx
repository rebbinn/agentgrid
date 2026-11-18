import { useState, type KeyboardEvent } from 'react'
import { formatShortcut } from '../lib/shortcuts'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { terminalRegistry } from '../terminal/registry'
import { Icon } from './Icon'

function countLines(text: string): number {
  const trimmed = text.replace(/[\r\n]+$/, '')
  return trimmed.length === 0 ? 0 : trimmed.split(/\r\n|\r|\n/).length
}

export function SendPanel() {
  const open = useUiStore((state) => state.sendPanelOpen)
  if (!open) return null
  return <SendPanelContent />
}

function SendPanelContent() {
  const draft = useUiStore((state) => state.sendDraft)
  const setDraft = useUiStore((state) => state.setSendDraft)
  const setOpen = useUiStore((state) => state.setSendPanelOpen)
  const pushToast = useUiStore((state) => state.pushToast)
  const panes = useTerminalStore((state) => state.panes)
  const activePaneId = useTerminalStore((state) => state.activePaneId)
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [execute, setExecute] = useState(true)

  const running = panes.filter((pane) => pane.status === 'running' && pane.sftpHostId === undefined)
  const target =
    running.find((pane) => pane.id === chosenId) ??
    running.find((pane) => pane.id === activePaneId) ??
    running[0]
  const lineCount = countLines(draft)
  const canSend = target !== undefined && draft.trim().length > 0

  const close = (): void => {
    setOpen(false)
    if (activePaneId) terminalRegistry.get(activePaneId)?.focus()
  }

  const send = (): void => {
    if (!target || draft.trim().length === 0) return
    const delivered = terminalRegistry.get(target.id)?.sendText(draft, execute) ?? false
    if (!delivered) {
      pushToast('warning', strings.send.notRunning)
      return
    }
    pushToast('success', strings.send.sent(target.title))
    setDraft('')
    useTerminalStore.getState().setActive(target.id)
    terminalRegistry.get(target.id)?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      send()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  return (
    <section className="send-panel" aria-label={strings.send.title} onKeyDown={handleKeyDown}>
      <header className="send-panel__header">
        <h2 className="send-panel__title">{strings.send.title}</h2>
        <label className="send-panel__target">
          <span className="visually-hidden">{strings.send.targetLabel}</span>
          <select
            aria-label={strings.send.targetLabel}
            value={target?.id ?? ''}
            disabled={running.length === 0}
            onChange={(event) => setChosenId(event.target.value)}
          >
            {running.length === 0 && <option value="">{strings.send.noRunning}</option>}
            {running.map((pane) => (
              <option key={pane.id} value={pane.id}>
                {pane.title}
              </option>
            ))}
          </select>
        </label>
        <span className="send-panel__spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label={strings.send.close}
          data-tip={`${strings.send.close} (${formatShortcut('toggleSend')})`}
          onClick={close}
        >
          <Icon name="close" size={14} />
        </button>
      </header>
      <textarea
        className="send-panel__text"
        aria-label={strings.send.textLabel}
        placeholder={strings.send.placeholder}
        value={draft}
        rows={4}
        spellCheck={false}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
      />
      <footer className="send-panel__footer">
        <label className="send-panel__execute">
          <input type="checkbox" checked={execute} onChange={(event) => setExecute(event.target.checked)} />
          {strings.send.execute}
        </label>
        <span className="send-panel__lines">{strings.send.lines(lineCount)}</span>
        <span className="send-panel__spacer" />
        <button type="button" className="btn btn--primary" disabled={!canSend} onClick={send}>
          <Icon name="send" size={14} />
          {strings.send.send}
        </button>
      </footer>
      <p className="send-panel__hint">{strings.send.hint}</p>
    </section>
  )
}
