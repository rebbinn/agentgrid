import { useLaunch } from '../hooks/use-launch'
import { useProjectPicker } from '../hooks/use-project-picker'
import { useProjectStore } from '../state/project-store'
import { useTerminalStore } from '../state/terminal-store'
import { strings } from '../strings'
import { ClaudeLogo } from './ClaudeLogo'
import { Icon } from './Icon'
import { PaneGrid } from './PaneGrid'
import { SendPanel } from './SendPanel'

export function Workspace() {
  const projectPath = useProjectStore((state) => state.projectPath)
  const hasPanes = useTerminalStore((state) => state.panes.length > 0)
  const pickProject = useProjectPicker()
  const launch = useLaunch()

  if (hasPanes) {
    return (
      <main className="workspace">
        <div className="workspace__stack">
          <PaneGrid />
          <SendPanel />
        </div>
      </main>
    )
  }

  return (
    <main className="workspace workspace--empty">
      <div className="empty-state">
        <Icon name="terminal" size={32} />
        <h1 className="empty-state__title">{strings.empty.noTerminalsTitle}</h1>
        <p className="empty-state__text">
          {projectPath ? strings.empty.noTerminalsText : strings.empty.noProjectText}
        </p>
        <div className="empty-state__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void launch({ agentId: 'claude' })}
          >
            <ClaudeLogo />
            {strings.empty.startClaude}
          </button>
          <button type="button" className="btn" onClick={() => void launch()}>
            <Icon name="terminal" />
            {strings.empty.plainTerminal}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void pickProject()}>
            <Icon name="folder" />
            {strings.empty.pickProject}
          </button>
        </div>
      </div>
    </main>
  )
}
