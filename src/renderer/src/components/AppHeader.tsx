import { togglePalette } from '../commands/actions'
import { useProjectPicker } from '../hooks/use-project-picker'
import { formatShortcut, withShortcut } from '../lib/shortcuts'
import { folderName } from '../lib/path'
import { useProjectStore } from '../state/project-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { LayoutSelector } from './LayoutSelector'
import { Logo } from './Logo'
import { NewTerminalButton } from './NewTerminalButton'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

export function AppHeader() {
  const projectPath = useProjectStore((state) => state.projectPath)
  const pickProject = useProjectPicker()

  return (
    <header className="header">
      <div className="header__inner">
        <div className="header__brand">
          <Logo />
          <span className="header__brand-name">{strings.appName}</span>
        </div>

        <WorkspaceSwitcher />

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
          className="btn btn--ghost palette-button"
          aria-label={strings.palette.open}
          data-tip={withShortcut(strings.palette.label, 'palette')}
          onClick={togglePalette}
        >
          <Icon name="search" size={14} />
          <span className="palette-button__text">{strings.palette.open}</span>
          <kbd className="palette__key">{formatShortcut('palette')}</kbd>
        </button>

        <LayoutSelector />

        <NewTerminalButton />
      </div>
    </header>
  )
}
