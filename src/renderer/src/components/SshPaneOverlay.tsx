import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { endpointLabel, type Host } from '@shared/hosts'
import { useHostsStore } from '../state/hosts-store'
import { useSshStore } from '../state/ssh-store'
import { useTerminalStore, type Pane } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { SshRequestView } from './SshRequestView'

interface SshPaneOverlayProps {
  pane: Pane
  host: Host | undefined
  onClose: () => void
}

export function sshFooterText(pane: Pane): string {
  if (pane.exitReason === 'lost') return strings.ssh.lostBar
  if (pane.exitReason === 'closed') return strings.ssh.closedBar
  return strings.ssh.exitedBar(pane.exitCode ?? 0)
}

function ConnectPrompt({ pane, host, onClose }: SshPaneOverlayProps & { host: Host }) {
  const connect = (): void => void useTerminalStore.getState().restart(pane.id)
  const isProd = host.environment === 'prod'
  const connectRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    connectRef.current?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      className="pane__overlay"
      data-tone={isProd ? 'danger' : undefined}
      role="group"
      aria-label={isProd ? strings.ssh.prodTitle : strings.ssh.savedTitle}
      onKeyDown={handleKeyDown}
    >
      <h2 className={`pane__overlay-title${isProd ? '' : ' pane__overlay-title--info'}`}>
        {isProd ? strings.ssh.prodTitle : strings.ssh.savedTitle}
      </h2>
      <p className="pane__overlay-text">
        {isProd ? strings.ssh.prodText(host.name, host.group) : strings.ssh.savedText(host.name, endpointLabel(host))}
      </p>
      {isProd && <p className="pane__overlay-text pane__overlay-mono">{endpointLabel(host)}</p>}
      <div className="empty-state__actions">
        <button
          ref={connectRef}
          type="button"
          className={`btn ${isProd ? 'btn--danger' : 'btn--primary'}`}
          onClick={connect}
        >
          <Icon name="terminal" />
          {strings.ssh.connect}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {isProd ? strings.ssh.cancel : strings.terminal.close}
        </button>
      </div>
      {isProd && <p className="pane__overlay-hint">{strings.ssh.prodHint}</p>}
    </div>
  )
}

function ConnectingView({ pane }: { pane: Pane }) {
  const request = useSshStore((state) => state.requests[pane.id])
  const phase = useSshStore((state) => state.phases[pane.id])
  if (request) {
    return (
      <div className="pane__overlay">
        <SshRequestView request={request} />
      </div>
    )
  }
  return (
    <div className="pane__overlay" role="status">
      <p className="pane__overlay-text">
        {phase ? strings.ssh.phase(phase.phase, phase.hostName) : strings.ssh.starting}
      </p>
      <button type="button" className="btn" onClick={() => window.agentgrid.terminal.kill(pane.id)}>
        {strings.ssh.cancel}
      </button>
    </div>
  )
}

function FailureView({ pane, host, onClose }: SshPaneOverlayProps) {
  const failure = pane.sshFailure
  const [forgetting, setForgetting] = useState(false)
  if (!failure) return null
  const retry = (): void => void useTerminalStore.getState().restart(pane.id)

  const forgetAndRetry = async (): Promise<void> => {
    if (!host) return
    setForgetting(true)
    try {
      const removed = await window.agentgrid.hosts.forgetHostKey(host.id)
      if (removed) retry()
      else useUiStore.getState().pushToast('warning', strings.ssh.keyNotForgotten(failure.knownHostsFile ?? ''))
    } finally {
      setForgetting(false)
    }
  }

  return (
    <div className="pane__overlay" role="alert">
      <h2 className="pane__overlay-title">{strings.ssh.errorTitle}</h2>
      <p className="pane__overlay-text">
        {strings.ssh.errorText(failure.code, failure.hostName ?? host?.name ?? '', failure.message)}
      </p>
      {failure.fingerprint && <code className="ssh-request__fingerprint">{failure.fingerprint}</code>}
      {failure.code === 'hostkey-changed' && (
        <p className="pane__overlay-text pane__overlay-warning">{strings.ssh.forgetKeyWarning}</p>
      )}
      <div className="empty-state__actions">
        {failure.code === 'hostkey-changed' ? (
          <button type="button" className="btn btn--danger" disabled={forgetting} onClick={() => void forgetAndRetry()}>
            {strings.ssh.forgetKey}
          </button>
        ) : (
          <button type="button" className="btn btn--primary" onClick={retry} disabled={!host}>
            <Icon name="restart" />
            {strings.terminal.retry}
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          {strings.terminal.close}
        </button>
      </div>
    </div>
  )
}

export function SshPaneOverlay({ pane, host, onClose }: SshPaneOverlayProps) {
  const hostsReady = useHostsStore((state) => state.status === 'ready')
  if (!host && !hostsReady) return null
  if (!host && (pane.status === 'idle' || pane.status === 'error')) {
    return (
      <div className="pane__overlay" role="alert">
        <h2 className="pane__overlay-title">{strings.ssh.errorTitle}</h2>
        <p className="pane__overlay-text">{strings.ssh.hostGone}</p>
        <div className="empty-state__actions">
          <button type="button" className="btn" onClick={onClose}>
            {strings.terminal.close}
          </button>
        </div>
      </div>
    )
  }
  if (pane.status === 'idle' && host) return <ConnectPrompt pane={pane} host={host} onClose={onClose} />
  if (pane.status === 'starting') return <ConnectingView pane={pane} />
  if (pane.status === 'error') return <FailureView pane={pane} host={host} onClose={onClose} />
  return null
}
