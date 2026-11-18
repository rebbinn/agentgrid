import { useHostsStore } from '../state/hosts-store'
import { startsInBulk, useTerminalStore } from '../state/terminal-store'
import { useWorkspaceStore } from '../state/workspace-store'
import { strings } from '../strings'
import { Icon } from './Icon'

export function RestoreBanner() {
  const hosts = useHostsStore((state) => state.views)
  const idleCount = useTerminalStore((state) => state.panes.filter((pane) => startsInBulk(pane, hosts)).length)
  const activeId = useWorkspaceStore((state) => state.activeId)
  const autoStart = useWorkspaceStore(
    (state) => state.workspaces.find((item) => item.id === state.activeId)?.autoStart ?? false
  )
  const setAutoStart = useWorkspaceStore((state) => state.setAutoStart)

  if (idleCount === 0) return null

  return (
    <div className="restore-banner" role="status" aria-label={strings.restore.bannerLabel}>
      <span className="restore-banner__text">{strings.restore.banner(idleCount)}</span>
      <button
        type="button"
        className="btn btn--primary"
        onClick={() => void useTerminalStore.getState().startAllIdle()}
      >
        <Icon name="restart" />
        {strings.restore.startAll}
      </button>
      <button
        type="button"
        className="btn"
        aria-pressed={autoStart}
        title={strings.restore.autoStartHint}
        onClick={() => activeId && setAutoStart(activeId, !autoStart)}
      >
        {autoStart ? '✓ ' : ''}
        {strings.restore.autoStart}
      </button>
    </div>
  )
}
