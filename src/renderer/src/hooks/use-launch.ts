import { useCallback } from 'react'
import type { AgentId } from '@shared/agents'
import { getAppInfo } from '../lib/app-info'
import { useProjectStore } from '../state/project-store'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'

export interface LaunchRequest {
  agentId?: AgentId
  shellId?: string
}

export function useLaunch(): (request?: LaunchRequest) => Promise<void> {
  return useCallback(async (request = {}) => {
    let cwd = useProjectStore.getState().projectPath
    if (!cwd) {
      try {
        cwd = (await getAppInfo()).homeDir
      } catch {
        useUiStore.getState().pushToast('error', strings.terminal.launchFailed)
        return
      }
    }
    await useTerminalStore.getState().launch({ cwd, ...request })
  }, [])
}
