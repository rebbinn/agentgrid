import { useEffect } from 'react'
import { AppHeader } from './components/AppHeader'
import { CloseConfirm } from './components/CloseConfirm'
import { Rail } from './components/Rail'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { Workspace } from './components/Workspace'
import { useCollapseSidebarWhenNarrow } from './hooks/use-narrow-window'
import { useTerminalStore } from './state/terminal-store'
import { terminalRegistry } from './terminal/registry'

export function App() {
  useCollapseSidebarWhenNarrow()

  useEffect(() => {
    terminalRegistry.init(useTerminalStore.getState().handleExit)
    return () => terminalRegistry.dispose()
  }, [])

  return (
    <div className="app">
      <AppHeader />
      <Rail />
      <Sidebar />
      <Workspace />
      <StatusBar />
      <CloseConfirm />
      <Toasts />
    </div>
  )
}
