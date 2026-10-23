import { create } from 'zustand'

const MAX_RECENT = 8

interface ProjectState {
  projectPath: string | null
  recentPaths: string[]
  openProject: (path: string) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectPath: null,
  recentPaths: [],
  openProject: (path) =>
    set((state) => ({
      projectPath: path,
      recentPaths: [path, ...state.recentPaths.filter((item) => item !== path)].slice(0, MAX_RECENT)
    }))
}))
