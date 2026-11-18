import { create } from 'zustand'
import type { HostSaveRequest, HostSaveResult, HostView } from '@shared/hosts'

export type HostsStatus = 'idle' | 'loading' | 'ready' | 'error'

interface HostsState {
  views: HostView[]
  status: HostsStatus
  query: string
  collapsedGroups: string[]
  load: () => Promise<void>
  refresh: () => Promise<void>
  save: (request: HostSaveRequest) => Promise<HostSaveResult>
  remove: (id: string) => Promise<void>
  setQuery: (query: string) => void
  toggleGroup: (group: string) => void
}

let loading: Promise<void> | null = null

export const useHostsStore = create<HostsState>((set, get) => ({
  views: [],
  status: 'idle',
  query: '',
  collapsedGroups: [],

  load: () => {
    loading ??= (async () => {
      if (get().status !== 'ready') set({ status: 'loading' })
      try {
        set({ views: await window.agentgrid.hosts.list(), status: 'ready' })
      } catch {
        if (get().status !== 'ready') set({ status: 'error' })
      } finally {
        loading = null
      }
    })()
    return loading
  },

  refresh: async () => {
    try {
      set({ views: await window.agentgrid.hosts.list(), status: 'ready' })
    } catch {
      if (get().status !== 'ready') set({ status: 'error' })
    }
  },

  save: async (request) => {
    const result = await window.agentgrid.hosts.save(request)
    if (result.ok) await get().refresh()
    return result
  },

  remove: async (id) => {
    await window.agentgrid.hosts.remove(id)
    await get().refresh()
  },

  setQuery: (query) => set({ query }),

  toggleGroup: (group) =>
    set((state) => ({
      collapsedGroups: state.collapsedGroups.includes(group)
        ? state.collapsedGroups.filter((item) => item !== group)
        : [...state.collapsedGroups, group]
    }))
}))

export function findHostView(id: string | undefined): HostView | undefined {
  if (!id) return undefined
  return useHostsStore.getState().views.find((view) => view.host.id === id)
}
