import { memo, type CSSProperties } from 'react'
import { useClosePane } from '../hooks/use-close-pane'
import { folderName } from '../lib/path'
import { useTerminalStore, type Pane } from '../state/terminal-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { TerminalView } from './TerminalView'

interface TerminalPaneProps {
  pane: Pane
  active: boolean
  style?: CSSProperties
}

function TerminalPaneComponent({ pane, active, style }: TerminalPaneProps) {
  const closePane = useClosePane()

  const activate = (): void => useTerminalStore.getState().setActive(pane.id)
  const restart = (): void => void useTerminalStore.getState().restart(pane.id)
  const clear = (): void => useTerminalStore.getState().clear(pane.id)

  return (
    <section
      className="pane"
      data-active={active}
      data-status={pane.status}
      style={style}
      aria-label={strings.terminal.paneLabel(pane.title)}
      onMouseDown={activate}
    >
      <header className="pane__header">
        <span
          className={`dot dot--${pane.status}`}
          role="img"
          aria-label={strings.terminal.states[pane.status]}
          title={strings.terminal.states[pane.status]}
        />
        <span className="pane__title">{pane.title}</span>
        <span className="pane__meta" title={pane.cwd}>
          {pane.shellLabel} · {folderName(pane.cwd)}
        </span>
        <span className="pane__spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label={strings.terminal.restart}
          data-tip={strings.terminal.restart}
          onClick={restart}
        >
          <Icon name="restart" size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={strings.terminal.clear}
          data-tip={strings.terminal.clear}
          onClick={clear}
        >
          <Icon name="clear" size={14} />
        </button>
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
        <TerminalView id={pane.id} active={active} />

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
