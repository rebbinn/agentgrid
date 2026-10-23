import { create } from 'zustand'
import { MAX_RECENT_PROJECTS } from '@shared/settings'

interface ProjectState {
  projectPath: string | null
  recentPaths: string[]
  openProject: (path: string) => void
  setProject: (path: string | null) => void
  setRecentPaths: (paths: string[]) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectPath: null,
  recentPaths: [],
  openProject: (path) =>
    set((state) => ({
      projectPath: path,
      recentPaths: [path, ...state.recentPaths.filter((item) => item !== path)].slice(0, MAX_RECENT_PROJECTS)
    })),
  setProject: (projectPath) => set({ projectPath }),
  setRecentPaths: (recentPaths) => set({ recentPaths: recentPaths.slice(0, MAX_RECENT_PROJECTS) })
}))
