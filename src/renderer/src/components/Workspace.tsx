import { useLaunch } from '../hooks/use-launch'
import { useProjectPicker } from '../hooks/use-project-picker'
import { useProjectStore } from '../state/project-store'
import { useTerminalStore } from '../state/terminal-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { PaneGrid } from './PaneGrid'

export function Workspace() {
  const projectPath = useProjectStore((state) => state.projectPath)
  const hasPanes = useTerminalStore((state) => state.panes.length > 0)
  const pickProject = useProjectPicker()
  const launch = useLaunch()

  if (hasPanes) {
    return (
      <main className="workspace">
        <PaneGrid />
      </main>
    )
  }

  return (
    <main className="workspace workspace--empty">
      {projectPath ? (
        <div className="empty-state">
          <Icon name="terminal" size={32} />
          <h1 className="empty-state__title">{strings.empty.noTerminalsTitle}</h1>
          <p className="empty-state__text">{strings.empty.noTerminalsText}</p>
          <div className="empty-state__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void launch({ agentId: 'claude' })}
            >
              <Icon name="spark" />
              {strings.empty.startClaude}
            </button>
            <button type="button" className="btn" onClick={() => void launch()}>
              <Icon name="terminal" />
              {strings.empty.plainTerminal}
            </button>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="folder" size={32} />
          <h1 className="empty-state__title">{strings.empty.noProjectTitle}</h1>
          <p className="empty-state__text">{strings.empty.noProjectText}</p>
          <div className="empty-state__actions">
            <button type="button" className="btn btn--primary" onClick={() => void pickProject()}>
              <Icon name="folder" />
              {strings.empty.pickProject}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
