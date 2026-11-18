import { folderName } from '../lib/path'
import { useProjectStore } from '../state/project-store'
import { countRunning, useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { switchWorkspace } from '../state/workspace-actions'
import { useWorkspaceStore } from '../state/workspace-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { PresetsSection } from './PresetsSection'
import { ServersPanel } from './ServersPanel'
import { SessionsPanel } from './SessionsPanel'

function WorkspacesSection() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeId = useWorkspaceStore((state) => state.activeId)
  const livePaneCount = useTerminalStore((state) => state.panes.length)
  const liveRunning = useTerminalStore((state) => countRunning(state.panes))
  const parked = useTerminalStore((state) => state.parked)
  const liveProject = useProjectStore((state) => state.projectPath)
  const openDialog = useUiStore((state) => state.openDialog)

  if (workspaces.length === 0) return null

  return (
    <section className="sidebar__section" aria-label={strings.workspace.listTitle}>
      <h2 className="sidebar__title">{strings.workspace.listTitle}</h2>
      {workspaces.map((item) => {
        const isActive = item.id === activeId
        const group = parked[item.id]
        const paneCount = isActive ? livePaneCount : (group?.panes.length ?? item.panes.length)
        const running = isActive ? liveRunning : countRunning(group?.panes ?? [])
        const project = isActive ? liveProject : item.projectPath
        return (
          <button
            key={item.id}
            type="button"
            className="path-item"
            aria-current={isActive ? 'true' : undefined}
            onClick={() => void switchWorkspace(item.id)}
          >
            <span className="path-item__name">{item.name}</span>
            <span className="path-item__path">
              {strings.workspace.paneCount(paneCount)} ·{' '}
              {running > 0 && <>{strings.workspace.runningCount(running)} · </>}
              {project ? folderName(project) : strings.workspace.noProject}
            </span>
          </button>
        )
      })}
      <button
        type="button"
        className="btn btn--ghost sidebar__action"
        onClick={() => openDialog({ kind: 'new-workspace' })}
      >
        <Icon name="plus" size={14} />
        {strings.workspace.newItem}
      </button>
    </section>
  )
}

function ProjectsPanel() {
  const projectPath = useProjectStore((state) => state.projectPath)
  const recentPaths = useProjectStore((state) => state.recentPaths)
  const openProject = useProjectStore((state) => state.openProject)
  const otherRecent = recentPaths.filter((path) => path !== projectPath)

  return (
    <>
      <WorkspacesSection />
      <PresetsSection />
      <section className="sidebar__section">
        <h2 className="sidebar__title">{strings.sidebar.project}</h2>
        {projectPath ? (
          <div className="path-item" aria-current="true">
            <span className="path-item__name">{folderName(projectPath)}</span>
            <span className="path-item__path" title={projectPath}>
              {projectPath}
            </span>
          </div>
        ) : (
          <p className="sidebar__empty">{strings.header.noProject}</p>
        )}
      </section>

      <section className="sidebar__section">
        <h2 className="sidebar__title">{strings.sidebar.recent}</h2>
        {otherRecent.length === 0 ? (
          <p className="sidebar__empty">{strings.sidebar.noRecent}</p>
        ) : (
          otherRecent.map((path) => (
            <button key={path} type="button" className="path-item" onClick={() => openProject(path)}>
              <span className="path-item__name">{folderName(path)}</span>
              <span className="path-item__path" title={path}>
                {path}
              </span>
            </button>
          ))
        )}
      </section>
    </>
  )
}

export function Sidebar() {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const sidebarTab = useUiStore((state) => state.sidebarTab)
  const sessionsTabOpen = useUiStore((state) => state.sessionsTabOpen)
  const selectSidebarTab = useUiStore((state) => state.selectSidebarTab)
  const closeSessionsTab = useUiStore((state) => state.closeSessionsTab)
  const serversTabOpen = useUiStore((state) => state.serversTabOpen)
  const closeServersTab = useUiStore((state) => state.closeServersTab)
  const showSessions = sessionsTabOpen && sidebarTab === 'sessions'
  const showServers = serversTabOpen && sidebarTab === 'servers'

  return (
    <aside className="sidebar" hidden={!sidebarOpen} aria-label="Layihələr">
      {(sessionsTabOpen || serversTabOpen) && (
        <div className="sidebar__tabs" role="tablist" aria-label={strings.sessions.tablist}>
          <button
            type="button"
            role="tab"
            className="sidebar-tab"
            aria-selected={!showSessions && !showServers}
            onClick={() => selectSidebarTab('projects')}
          >
            {strings.sidebar.tabProjects}
          </button>
          {sessionsTabOpen && (
          <div className="sidebar-tab sidebar-tab--closable" data-selected={showSessions}>
            <button
              type="button"
              role="tab"
              className="sidebar-tab__label"
              aria-selected={showSessions}
              onClick={() => selectSidebarTab('sessions')}
            >
              {strings.sessions.tab}
            </button>
            <button
              type="button"
              className="sidebar-tab__close"
              aria-label={strings.sessions.tabClose}
              data-tip={strings.sessions.tabClose}
              onClick={closeSessionsTab}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
          )}
          {serversTabOpen && (
            <div className="sidebar-tab sidebar-tab--closable" data-selected={showServers}>
              <button
                type="button"
                role="tab"
                className="sidebar-tab__label"
                aria-selected={showServers}
                onClick={() => selectSidebarTab('servers')}
              >
                {strings.servers.tab}
              </button>
              <button
                type="button"
                className="sidebar-tab__close"
                aria-label={strings.servers.tabClose}
                data-tip={strings.servers.tabClose}
                onClick={closeServersTab}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          )}
        </div>
      )}

      {showSessions ? <SessionsPanel /> : showServers ? <ServersPanel /> : <ProjectsPanel />}
    </aside>
  )
}
