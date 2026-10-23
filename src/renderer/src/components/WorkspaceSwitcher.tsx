import { folderName } from '../lib/path'
import { useProjectStore } from '../state/project-store'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { requestWorkspaceSwitch } from '../state/workspace-actions'
import { useWorkspaceStore } from '../state/workspace-store'
import { strings } from '../strings'
import { Dropdown, type DropdownItem } from './Dropdown'
import { Icon } from './Icon'

export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeId = useWorkspaceStore((state) => state.activeId)
  const livePaneCount = useTerminalStore((state) => state.panes.length)
  const liveProject = useProjectStore((state) => state.projectPath)
  const openDialog = useUiStore((state) => state.openDialog)
  const active = workspaces.find((item) => item.id === activeId)

  const items: DropdownItem[] = [
    ...workspaces.map(
      (item): DropdownItem => {
        const isActive = item.id === activeId
        const paneCount = isActive ? livePaneCount : item.panes.length
        const project = isActive ? liveProject : item.projectPath
        return {
          id: item.id,
          label: item.name,
          hint: `${strings.workspace.paneCount(paneCount)} · ${project ? folderName(project) : strings.workspace.noProject}`,
          role: 'menuitemradio',
          checked: isActive,
          onSelect: () => requestWorkspaceSwitch(item.id)
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
