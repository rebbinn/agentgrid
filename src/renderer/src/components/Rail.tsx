import { useLaunch } from '../hooks/use-launch'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { Icon } from './Icon'

export function Rail() {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const launch = useLaunch()

  return (
    <nav className="rail" aria-label="Agentlər">
      <button
        type="button"
        className="rail-button rail-button--agent"
        aria-label={strings.rail.claude}
        data-tip={strings.rail.claudeTip}
        onClick={() => void launch({ agentId: 'claude' })}
      >
        <Icon name="spark" size={18} />
      </button>

      <div className="rail__spacer" />

      <button
        type="button"
        className="rail-button"
        aria-label={strings.rail.toggleSidebar}
        aria-pressed={sidebarOpen}
        data-tip={strings.rail.toggleSidebar}
        onClick={toggleSidebar}
      >
        <Icon name="panel" size={18} />
      </button>
    </nav>
  )
}
