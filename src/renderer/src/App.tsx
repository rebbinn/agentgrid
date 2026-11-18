import { useEffect } from 'react'
import { AppHeader } from './components/AppHeader'
import { CloseConfirm } from './components/CloseConfirm'
import { CommandPalette } from './components/CommandPalette'
import { Rail } from './components/Rail'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { ToolDialogs } from './components/ToolDialogs'
import { Workspace } from './components/Workspace'
import { WorkspaceDialogs } from './components/WorkspaceDialogs'
import { useGlobalShortcuts } from './hooks/use-global-shortcuts'
import { useLaunchRequests } from './hooks/use-launch-requests'
import { useCollapseSidebarWhenNarrow } from './hooks/use-narrow-window'
import { useHostsStore } from './state/hosts-store'
import { startSshEvents, stopSshEvents } from './state/ssh-store'
import { useTerminalStore } from './state/terminal-store'
import { terminalRegistry } from './terminal/registry'

export function App() {
  useCollapseSidebarWhenNarrow()
  useLaunchRequests()
  useGlobalShortcuts()

  useEffect(() => {
    terminalRegistry.init(useTerminalStore.getState().handleExit)
    startSshEvents()
    void useHostsStore.getState().load()
    return () => {
      terminalRegistry.dispose()
      stopSshEvents()
    }
  }, [])

  return (
    <div className="app">
      <AppHeader />
      <Rail />
      <Sidebar />
      <Workspace />
      <StatusBar />
      <CloseConfirm />
      <WorkspaceDialogs />
      <ToolDialogs />
      <CommandPalette />
      <Toasts />
    </div>
  )
}
