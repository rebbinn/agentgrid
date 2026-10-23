import type { Workspace } from '@shared/settings'
import { strings } from '../strings'
import { captureLayout, useLayoutStore } from './layout-store'
import { withPersistencePaused } from './persistence-gate'
import { useProjectStore } from './project-store'
import { capturePanes, useTerminalStore } from './terminal-store'
import { useUiStore } from './ui-store'
import {
  emptyWorkspace,
  suggestWorkspaceName,
  useWorkspaceStore,
  type LiveWorkspacePart
} from './workspace-store'

export function captureLive(): LiveWorkspacePart {
  const { panes, activePane } = capturePanes()
  return {
    projectPath: useProjectStore.getState().projectPath,
    layout: captureLayout(),
    panes,
    activePane
  }
}

export function syncActiveWorkspace(): void {
  const { activeId, updateWorkspace } = useWorkspaceStore.getState()
  if (activeId) updateWorkspace(activeId, captureLive())
}

export function runningPaneCount(): number {
  return useTerminalStore
    .getState()
    .panes.filter((pane) => pane.status === 'running' || pane.status === 'starting').length
}

export async function applyWorkspace(workspace: Workspace): Promise<void> {
  useTerminalStore.getState().reset()
  useProjectStore.getState().setProject(workspace.projectPath)
  useLayoutStore.getState().applyLayout(workspace.layout)
  useWorkspaceStore.getState().setActiveId(workspace.id)
  await useTerminalStore.getState().restorePanes(workspace.panes, workspace.activePane, workspace.autoStart)
}

export function nextWorkspaceName(): string {
  return suggestWorkspaceName(
    useWorkspaceStore.getState().workspaces.map((item) => item.name),
    strings.workspace.namePrefix
  )
}

export function requestWorkspaceSwitch(id: string): void {
  if (id === useWorkspaceStore.getState().activeId) return
  if (runningPaneCount() > 0) {
    useUiStore.getState().openDialog({ kind: 'switch-workspace', id })
    return
  }
  void switchWorkspace(id)
}

export async function switchWorkspace(id: string): Promise<void> {
  const { workspaces, activeId } = useWorkspaceStore.getState()
  const target = workspaces.find((item) => item.id === id)
  if (!target || id === activeId) return
  await withPersistencePaused(async () => {
    syncActiveWorkspace()
    const fresh = useWorkspaceStore.getState().workspaces.find((item) => item.id === id) ?? target
    await applyWorkspace(fresh)
  })
}

export async function createWorkspace(name: string): Promise<void> {
  await withPersistencePaused(async () => {
    syncActiveWorkspace()
    const created = emptyWorkspace(name)
    useWorkspaceStore.getState().add(created)
    await applyWorkspace(created)
  })
}

export async function deleteWorkspace(id: string): Promise<void> {
  await withPersistencePaused(async () => {
    const store = useWorkspaceStore.getState()
    const index = store.workspaces.findIndex((item) => item.id === id)
    if (index === -1) return
    if (id !== store.activeId) {
      store.remove(id)
      return
    }
    const remaining = store.workspaces.filter((item) => item.id !== id)
    let next = remaining[index] ?? remaining[index - 1]
    store.remove(id)
    if (!next) {
      next = emptyWorkspace(strings.workspace.defaultName)
      store.add(next)
    }
    await applyWorkspace(next)
  })
}

export function renameWorkspace(id: string, name: string): void {
  useWorkspaceStore.getState().rename(id, name)
}
