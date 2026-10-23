import { create } from 'zustand'
import { MAX_WORKSPACE_NAME, type Workspace } from '@shared/settings'

export type LiveWorkspacePart = Pick<Workspace, 'projectPath' | 'layout' | 'panes' | 'activePane'>

interface WorkspaceState {
  ready: boolean
  workspaces: Workspace[]
  activeId: string | null
  setReady: (ready: boolean) => void
  setWorkspaces: (workspaces: Workspace[], activeId: string | null) => void
  setActiveId: (id: string) => void
  add: (workspace: Workspace) => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  setAutoStart: (id: string, autoStart: boolean) => void
  updateWorkspace: (id: string, part: LiveWorkspacePart) => void
}

export function emptyWorkspace(name: string, projectPath: string | null = null): Workspace {
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, MAX_WORKSPACE_NAME),
    projectPath,
    layout: { preset: 'auto', columnSizes: [], rowSizes: [], focusMode: false },
    panes: [],
    activePane: null,
    autoStart: false
  }
}

export function suggestWorkspaceName(existing: readonly string[], prefix: string): string {
  const used = new Set(existing)
  for (let index = existing.length + 1; ; index++) {
    const candidate = `${prefix} ${index}`
    if (!used.has(candidate)) return candidate
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ready: false,
  workspaces: [],
  activeId: null,
  setReady: (ready) => set({ ready }),
  setWorkspaces: (workspaces, activeId) => set({ workspaces, activeId }),
  setActiveId: (activeId) => set({ activeId }),
  add: (workspace) => set((state) => ({ workspaces: [...state.workspaces, workspace] })),
  rename: (id, name) => {
    const trimmed = name.trim().slice(0, MAX_WORKSPACE_NAME)
    if (trimmed.length === 0) return
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === id ? { ...item, name: trimmed } : item))
    }))
  },
  remove: (id) => set((state) => ({ workspaces: state.workspaces.filter((item) => item.id !== id) })),
  setAutoStart: (id, autoStart) =>
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === id ? { ...item, autoStart } : item))
    })),
  updateWorkspace: (id, part) =>
    set((state) => ({
      workspaces: state.workspaces.map((item) => (item.id === id ? { ...item, ...part } : item))
    }))
}))
