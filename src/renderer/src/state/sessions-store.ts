import { create } from 'zustand'
import type { ClaudeSession } from '@shared/ipc'

export type SessionsStatus = 'idle' | 'loading' | 'ready' | 'error'

interface SessionsState {
  sessions: ClaudeSession[]
  status: SessionsStatus
  showAll: boolean
  query: string
  load: () => Promise<void>
  toggleShowAll: () => void
  setQuery: (query: string) => void
}

let latestRequest = 0

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  status: 'idle',
  showAll: false,
  query: '',
  load: async () => {
    const request = ++latestRequest
    set({ status: 'loading' })
    try {
      const sessions = await window.agentgrid.sessions.list()
      if (request === latestRequest) set({ sessions, status: 'ready' })
    } catch {
      if (request === latestRequest) set({ status: 'error' })
    }
  },
  toggleShowAll: () => set((state) => ({ showAll: !state.showAll })),
  setQuery: (query) => set({ query })
}))
