import { folderName } from '../lib/path'
import { useProjectStore } from '../state/project-store'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { requestWorkspaceSwitch } from '../state/workspace-actions'
import { useWorkspaceStore } from '../state/workspace-store'
import { strings } from '../strings'
import { Icon } from './Icon'
import { SessionsPanel } from './SessionsPanel'

function WorkspacesSection() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeId = useWorkspaceStore((state) => state.activeId)
  const livePaneCount = useTerminalStore((state) => state.panes.length)
  const liveProject = useProjectStore((state) => state.projectPath)
  const openDialog = useUiStore((state) => state.openDialog)

  if (workspaces.length === 0) return null

  return (
    <section className="sidebar__section" aria-label={strings.workspace.listTitle}>
      <h2 className="sidebar__title">{strings.workspace.listTitle}</h2>
      {workspaces.map((item) => {
        const isActive = item.id === activeId
        const paneCount = isActive ? livePaneCount : item.panes.length
        const project = isActive ? liveProject : item.projectPath
        return (
          <button
            key={item.id}
            type="button"
            className="path-item"
            aria-current={isActive ? 'true' : undefined}
            onClick={() => requestWorkspaceSwitch(item.id)}
          >
            <span className="path-item__name">{item.name}</span>
            <span className="path-item__path">
              {strings.workspace.paneCount(paneCount)} ·{' '}
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
  const showSessions = sessionsTabOpen && sidebarTab === 'sessions'

  return (
    <aside className="sidebar" hidden={!sidebarOpen} aria-label="Layihələr">
      {sessionsTabOpen && (
        <div className="sidebar__tabs" role="tablist" aria-label={strings.sessions.tablist}>
          <button
            type="button"
            role="tab"
            className="sidebar-tab"
            aria-selected={!showSessions}
            onClick={() => selectSidebarTab('projects')}
          >
            {strings.sidebar.tabProjects}
          </button>
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
        </div>
      )}

      {showSessions ? <SessionsPanel /> : <ProjectsPanel />}
    </aside>
  )
}
