import { create } from 'zustand'
import type { AgentStatus } from '@shared/ipc'

interface AgentsState {
  status: AgentStatus | null
  load: () => Promise<void>
}

export const useAgentsStore = create<AgentsState>((set) => ({
  status: null,
  load: async () => {
    try {
      set({ status: await window.agentgrid.agents.status() })
    } catch {
      set({ status: null })
    }
  }
}))
