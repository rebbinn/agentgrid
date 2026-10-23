import { useProjectPicker } from '../hooks/use-project-picker'
import { useProjectStore } from '../state/project-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { Icon } from './Icon'

export function Workspace() {
  const projectPath = useProjectStore((state) => state.projectPath)
  const pickProject = useProjectPicker()
  const pushToast = useUiStore((state) => state.pushToast)

  return (
    <main className="workspace">
      {projectPath ? (
        <div className="empty-state">
          <Icon name="terminal" size={32} />
          <h1 className="empty-state__title">{strings.empty.noTerminalsTitle}</h1>
          <p className="empty-state__text">{strings.empty.noTerminalsText}</p>
          <div className="empty-state__actions">
            <button
              type="button"
              className="btn btn--primary"
              aria-disabled="true"
              data-tip={strings.pendingEngine}
              onClick={() => pushToast('warning', strings.pendingEngine)}
            >
              <Icon name="spark" />
              {strings.empty.startClaude}
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
