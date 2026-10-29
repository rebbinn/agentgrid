import { folderName } from '../lib/path'
import { useProjectStore } from '../state/project-store'
import { countRunning, useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { switchWorkspace } from '../state/workspace-actions'
import { useWorkspaceStore } from '../state/workspace-store'
import { strings } from '../strings'
import { Dropdown, type DropdownItem } from './Dropdown'
import { Icon } from './Icon'

export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeId = useWorkspaceStore((state) => state.activeId)
  const livePaneCount = useTerminalStore((state) => state.panes.length)
  const liveRunning = useTerminalStore((state) => countRunning(state.panes))
  const parked = useTerminalStore((state) => state.parked)
  const liveProject = useProjectStore((state) => state.projectPath)
  const openDialog = useUiStore((state) => state.openDialog)
  const active = workspaces.find((item) => item.id === activeId)

  const items: DropdownItem[] = [
    ...workspaces.map(
      (item): DropdownItem => {
        const isActive = item.id === activeId
        const group = parked[item.id]
        const paneCount = isActive ? livePaneCount : (group?.panes.length ?? item.panes.length)
        const running = isActive ? liveRunning : countRunning(group?.panes ?? [])
        const project = isActive ? liveProject : item.projectPath
        const runningPart = running > 0 ? `${strings.workspace.runningCount(running)} · ` : ''
        return {
          id: item.id,
          label: item.name,
          hint: `${strings.workspace.paneCount(paneCount)} · ${runningPart}${project ? folderName(project) : strings.workspace.noProject}`,
          role: 'menuitemradio',
          checked: isActive,
          onSelect: () => void switchWorkspace(item.id)
        }
      }
    ),
    {
      id: 'new',
      label: strings.workspace.newItem,
      separatorBefore: true,
      onSelect: () => openDialog({ kind: 'new-workspace' })
    },
    {
      id: 'rename',
      label: strings.workspace.renameItem,
      disabled: !active,
      onSelect: () => active && openDialog({ kind: 'rename-workspace', id: active.id })
    },
    {
      id: 'delete',
      label: strings.workspace.deleteItem,
      disabled: !active,
      onSelect: () => active && openDialog({ kind: 'delete-workspace', id: active.id })
    }
  ]

  return (
    <Dropdown
      label={strings.workspace.switcherLabel}
      items={items}
      align="left"
      buttonClassName="btn btn--ghost workspace-button"
    >
      <Icon name="layers" />
      <span className="workspace-button__name">{active?.name ?? strings.workspace.defaultName}</span>
      <Icon name="chevron" size={12} />
    </Dropdown>
  )
}
