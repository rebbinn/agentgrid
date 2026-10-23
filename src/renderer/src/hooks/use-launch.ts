import { useCallback } from 'react'
import type { AgentId } from '@shared/agents'
import { useProjectPicker } from './use-project-picker'
import { useProjectStore } from '../state/project-store'
import { useTerminalStore } from '../state/terminal-store'

export interface LaunchRequest {
  agentId?: AgentId
  shellId?: string
}

export function useLaunch(): (request?: LaunchRequest) => Promise<void> {
  const pickProject = useProjectPicker()

  return useCallback(
    async (request = {}) => {
      let cwd = useProjectStore.getState().projectPath
      if (!cwd) {
        await pickProject()
        cwd = useProjectStore.getState().projectPath
      }
      if (!cwd) return
      await useTerminalStore.getState().launch({ cwd, ...request })
    },
    [pickProject]
  )
}
