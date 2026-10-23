import { folderName } from '../lib/path'
import { useProjectStore } from '../state/project-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'

export function Sidebar() {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen)
  const projectPath = useProjectStore((state) => state.projectPath)
  const recentPaths = useProjectStore((state) => state.recentPaths)
  const openProject = useProjectStore((state) => state.openProject)
  const otherRecent = recentPaths.filter((path) => path !== projectPath)

  return (
    <aside className="sidebar" hidden={!sidebarOpen} aria-label="Layihələr">
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
            <button
              key={path}
              type="button"
              className="path-item"
              onClick={() => openProject(path)}
            >
              <span className="path-item__name">{folderName(path)}</span>
              <span className="path-item__path" title={path}>
                {path}
              </span>
            </button>
          ))
        )}
      </section>
    </aside>
  )
}
