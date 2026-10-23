import { useEffect } from 'react'
import { App } from './App'
import { restoreSession } from './state/persistence'
import { useWorkspaceStore } from './state/workspace-store'
import { strings } from './strings'

export function AppRoot() {
  const ready = useWorkspaceStore((state) => state.ready)

  useEffect(() => {
    void restoreSession()
  }, [])

  if (!ready) return <div className="app-loading" role="status" aria-label={strings.workspace.loading} />
  return <App />
}
