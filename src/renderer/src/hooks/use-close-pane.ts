import { useCallback } from 'react'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'

export function useClosePane(): (id: string) => void {
  return useCallback((id: string) => {
    const pane = useTerminalStore.getState().panes.find((candidate) => candidate.id === id)
    if (!pane) return
    const needsConfirmation = pane.status === 'running' || pane.status === 'starting'
    if (needsConfirmation) {
      useUiStore.getState().askToClose(id)
      return
    }
    useTerminalStore.getState().close(id)
  }, [])
}
