import { useProjectPicker } from '../hooks/use-project-picker'
import { folderName } from '../lib/path'
import { useProjectStore } from '../state/project-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { Logo } from './Logo'
import { NewTerminalButton } from './NewTerminalButton'

export function AppHeader() {
  const projectPath = useProjectStore((state) => state.projectPath)
  const pickProject = useProjectPicker()
  const pushToast = useUiStore((state) => state.pushToast)

  const layoutNotReady = (): void => {
    pushToast('warning', strings.pendingLayout)
  }

  return (
    <header className="header">
      <div className="header__inner">
        <div className="header__brand">
          <Logo />
          <span className="header__brand-name">{strings.appName}</span>
        </div>

        <button
          type="button"
          className="project-chip"
          onClick={() => void pickProject()}
          title={projectPath ?? strings.header.openProject}
          aria-label={strings.header.openProject}
        >
          <Icon name="folder" />
          <span className="project-chip__text">
            {projectPath ? folderName(projectPath) : strings.header.noProject}
          </span>
        </button>

        <div className="header__spacer" />

        <button
          type="button"
          className="btn"
          aria-disabled="true"
          data-tip={strings.pendingLayout}
          onClick={layoutNotReady}
        >
          <Icon name="grid" />
          {strings.header.layout}
        </button>

        <NewTerminalButton />
      </div>
    </header>
  )
}
