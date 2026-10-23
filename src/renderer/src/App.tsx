import { AppHeader } from './components/AppHeader'
import { Rail } from './components/Rail'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toasts } from './components/Toasts'
import { Workspace } from './components/Workspace'
import { useCollapseSidebarWhenNarrow } from './hooks/use-narrow-window'

export function App() {
  useCollapseSidebarWhenNarrow()

  return (
    <div className="app">
      <AppHeader />
      <Rail />
      <Sidebar />
      <Workspace />
      <StatusBar />
      <Toasts />
    </div>
  )
}
