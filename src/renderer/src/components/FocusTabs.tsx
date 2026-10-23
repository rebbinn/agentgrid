import { useTerminalStore } from '../state/terminal-store'
import { strings } from '../strings'

export function FocusTabs() {
  const panes = useTerminalStore((state) => state.panes)
  const activePaneId = useTerminalStore((state) => state.activePaneId)
  const setActive = useTerminalStore((state) => state.setActive)

  return (
    <div className="focus-tabs" role="tablist" aria-label={strings.layout.tabs}>
      {panes.map((pane) => (
        <button
          key={pane.id}
          type="button"
          role="tab"
          className="focus-tab"
          aria-selected={pane.id === activePaneId}
          onClick={() => setActive(pane.id)}
        >
          <span className={`dot dot--${pane.status}`} aria-hidden="true" />
          {pane.title}
        </button>
      ))}
    </div>
  )
}
