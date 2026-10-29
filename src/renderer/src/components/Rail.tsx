import { openSettings, toggleSendPanel } from '../commands/actions'
import { useLaunch } from '../hooks/use-launch'
import { withShortcut } from '../lib/shortcuts'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { ClaudeLogo } from './ClaudeLogo'
import { Icon } from './Icon'

export function Rail() {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const sessionsVisible = useUiStore(
    (state) => state.sidebarOpen && state.sessionsTabOpen && state.sidebarTab === 'sessions'
  )
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const toggleSessionsTab = useUiStore((state) => state.toggleSessionsTab)
  const sendOpen = useUiStore((state) => state.sendPanelOpen)
  const launch = useLaunch()

  return (
    <nav className="rail" aria-label="Agentlər">
      <button
        type="button"
        className="rail-button rail-button--agent"
        aria-label={strings.rail.claude}
        data-tip={withShortcut(strings.rail.claudeTip, 'newClaude')}
        onClick={() => void launch({ agentId: 'claude' })}
      >
        <ClaudeLogo size={20} />
      </button>

      <button
        type="button"
        className="rail-button"
        aria-label={strings.sessions.railTip}
        aria-pressed={sessionsVisible}
        data-tip={withShortcut(strings.sessions.railTip, 'toggleSessions')}
        onClick={toggleSessionsTab}
      >
        <Icon name="history" size={18} />
      </button>

      <div className="rail__spacer" />

      <button
        type="button"
        className="rail-button"
        aria-label={strings.send.toggle}
        aria-pressed={sendOpen}
        data-tip={withShortcut(strings.send.toggle, 'toggleSend')}
        onClick={toggleSendPanel}
      >
        <Icon name="send" size={18} />
      </button>

      <button
        type="button"
        className="rail-button"
        aria-label={strings.settings.title}
        data-tip={withShortcut(strings.settings.title, 'openSettings')}
        onClick={openSettings}
      >
        <Icon name="settings" size={18} />
      </button>

      <button
        type="button"
        className="rail-button"
        aria-label={strings.rail.toggleSidebar}
        aria-pressed={sidebarOpen}
        data-tip={withShortcut(strings.rail.toggleSidebar, 'toggleSidebar')}
        onClick={toggleSidebar}
      >
        <Icon name="panel" size={18} />
      </button>
    </nav>
  )
}
