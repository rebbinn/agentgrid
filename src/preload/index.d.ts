import type { AgentGridApi } from '../shared/ipc'

declare global {
  interface Window {
    agentgrid: AgentGridApi
  }
}
