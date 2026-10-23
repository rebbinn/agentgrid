import { autoGridDimensions } from '../lib/auto-grid'
import { useTerminalStore } from '../state/terminal-store'
import { TerminalPane } from './TerminalPane'

export function PaneGrid() {
  const panes = useTerminalStore((state) => state.panes)
  const activePaneId = useTerminalStore((state) => state.activePaneId)
  const { columns, rows } = autoGridDimensions(panes.length)
  const lastPaneSpan = columns - ((panes.length - 1) % columns)

  return (
    <div
      className="pane-grid"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
      }}
    >
      {panes.map((pane, index) => (
        <TerminalPane
          key={pane.id}
          pane={pane}
          active={pane.id === activePaneId}
          style={index === panes.length - 1 && lastPaneSpan > 1 ? { gridColumn: `span ${lastPaneSpan}` } : undefined}
        />
      ))}
    </div>
  )
}
