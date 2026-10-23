import { useCallback } from 'react'
import type { ClaudeSession } from '@shared/ipc'
import { useLaunch } from './use-launch'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'

export function useOpenSession(): (session: ClaudeSession) => Promise<void> {
  const launch = useLaunch()

  return useCallback(
    async (session) => {
      const store = useTerminalStore.getState()
      const alreadyOpen = store.panes.find(
        (pane) =>
          pane.resumeSessionId === session.id &&
          (pane.status === 'running' || pane.status === 'starting')
      )
      if (alreadyOpen) {
        store.setActive(alreadyOpen.id)
        useUiStore.getState().pushToast('warning', strings.sessions.alreadyOpen)
        return
      }
      await launch({
        agentId: 'claude',
        cwd: session.cwd,
        resumeSessionId: session.id,
        title: strings.sessions.paneTitle(session.title)
      })
    },
    [launch]
  )
}
