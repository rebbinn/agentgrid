import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'
import { getAppInfo } from '../lib/app-info'
import { resolveGrid } from '../lib/layout'
import { useLayoutStore } from '../state/layout-store'
import { useProjectStore } from '../state/project-store'
import { useTerminalStore } from '../state/terminal-store'
import { strings } from '../strings'

export function StatusBar() {
  const projectPath = useProjectStore((state) => state.projectPath)
  const paneCount = useTerminalStore((state) => state.panes.length)
  const activeTitle = useTerminalStore(
    (state) => state.panes.find((pane) => pane.id === state.activePaneId)?.title ?? null
  )
  const preset = useLayoutStore((state) => state.preset)
  const focusMode = useLayoutStore((state) => state.focusMode)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const grid = resolveGrid(preset, paneCount)

  useEffect(() => {
    let cancelled = false
    getAppInfo()
      .then((value) => {
        if (!cancelled) setInfo(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <footer className="statusbar">
      <span className="statusbar__item">
        <span className={`dot ${info ? 'dot--running' : ''}`} aria-hidden="true" />
        {strings.status.ready}
      </span>
      {projectPath && (
        <span className="statusbar__item statusbar__item--shrink" title={projectPath}>
          {projectPath}
        </span>
      )}
      <span className="statusbar__spacer" />
      {activeTitle && <span className="statusbar__item">{strings.status.active(activeTitle)}</span>}
      {paneCount > 0 && (
        <span className="statusbar__item">
          {focusMode ? strings.status.focus : strings.status.grid(grid.columns, grid.rows)}
        </span>
      )}
      <span className="statusbar__item">{strings.status.terminals(paneCount)}</span>
      {info && (
        <span className="statusbar__item">
          {info.name} {info.version}
        </span>
      )}
    </footer>
  )
}
