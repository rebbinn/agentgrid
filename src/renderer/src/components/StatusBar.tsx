import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/ipc'
import { useProjectStore } from '../state/project-store'
import { strings } from '../strings'

export function StatusBar() {
  const projectPath = useProjectStore((state) => state.projectPath)
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    window.agentgrid.app
      .info()
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
        <span className={`dot ${info ? 'dot--ok' : ''}`} aria-hidden="true" />
        {strings.status.ready}
      </span>
      {projectPath && (
        <span className="statusbar__item statusbar__item--shrink" title={projectPath}>
          {projectPath}
        </span>
      )}
      <span className="statusbar__spacer" />
      <span className="statusbar__item">{strings.status.terminals(0)}</span>
      {info && (
        <span className="statusbar__item">
          {info.name} {info.version}
        </span>
      )}
    </footer>
  )
}
