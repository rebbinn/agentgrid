import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { getAppInfo } from '../lib/app-info'
import { folderName } from '../lib/path'
import { filterSessions } from '../lib/sessions'
import { formatRelativeTime } from '../lib/time'
import { useOpenSession } from '../hooks/use-open-session'
import { useProjectStore } from '../state/project-store'
import { useSessionsStore } from '../state/sessions-store'
import { strings } from '../strings'
import { Icon } from './Icon'

export function SessionsPanel() {
  const sessions = useSessionsStore((state) => state.sessions)
  const status = useSessionsStore((state) => state.status)
  const showAll = useSessionsStore((state) => state.showAll)
  const query = useSessionsStore((state) => state.query)
  const load = useSessionsStore((state) => state.load)
  const toggleShowAll = useSessionsStore((state) => state.toggleShowAll)
  const setQuery = useSessionsStore((state) => state.setQuery)
  const projectPath = useProjectStore((state) => state.projectPath)
  const openSession = useOpenSession()
  const [homeDir, setHomeDir] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    getAppInfo()
      .then((info) => setHomeDir(info.homeDir))
      .catch(() => setHomeDir(null))
  }, [])

  const folder = projectPath ?? homeDir
  const visible = useMemo(
    () => filterSessions(sessions, { folder, showAll, query }),
    [sessions, folder, showAll, query]
  )

  const focusItem = (offset: number): void => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('.session-item') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = index === -1 ? (offset > 0 ? 0 : items.length - 1) : index + offset
    if (next < 0) searchRef.current?.focus()
    else items[Math.min(next, items.length - 1)]?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.ctrlKey && !event.altKey && !event.shiftKey && event.code === 'KeyA') {
      event.preventDefault()
      toggleShowAll()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusItem(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusItem(-1)
    }
  }

  const emptyText = query.trim()
    ? strings.sessions.emptySearch
    : showAll
      ? strings.sessions.emptyAll
      : strings.sessions.emptyProject

  return (
    <section className="sessions" aria-label={strings.sessions.tab} onKeyDown={handleKeyDown}>
      <div className="sessions__toolbar">
        <div className="segmented" role="group" aria-label={strings.sessions.scopeLabel}>
          <button
            type="button"
            className="segmented__option"
            aria-pressed={!showAll}
            onClick={() => showAll && toggleShowAll()}
          >
            {strings.sessions.scopeProject}
          </button>
          <button
            type="button"
            className="segmented__option"
            aria-pressed={showAll}
            onClick={() => !showAll && toggleShowAll()}
          >
            {strings.sessions.scopeAll}
          </button>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={strings.sessions.refresh}
          data-tip={strings.sessions.refresh}
          onClick={() => void load()}
        >
          <Icon name="restart" size={14} />
        </button>
      </div>

      <input
        ref={searchRef}
        className="sessions__search"
        type="search"
        aria-label={strings.sessions.searchLabel}
        placeholder={strings.sessions.searchPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div ref={listRef} className="sessions__list" role="list" aria-label={strings.sessions.listLabel}>
        {status === 'loading' && sessions.length === 0 && (
          <p className="sidebar__empty">{strings.sessions.loading}</p>
        )}

        {status === 'error' && (
          <div className="sessions__error" role="alert">
            <p className="sidebar__empty">{strings.sessions.loadFailed}</p>
            <button type="button" className="btn" onClick={() => void load()}>
              {strings.sessions.retry}
            </button>
          </div>
        )}

        {status !== 'error' && status !== 'loading' && visible.length === 0 && (
          <p className="sidebar__empty">{emptyText}</p>
        )}

        {visible.map((session) => (
          <div key={session.id} role="listitem">
            <button
              type="button"
              className="session-item"
              title={`${session.title}\n${session.cwd}`}
              aria-label={strings.sessions.open(session.title)}
              onClick={() => void openSession(session)}
            >
              <span className="session-item__title">{session.title}</span>
              <span className="session-item__meta">
                {showAll && <span className="session-item__folder">{folderName(session.cwd)}</span>}
                <span>{formatRelativeTime(session.modifiedAt)}</span>
              </span>
            </button>
          </div>
        ))}
      </div>

      <p className="sessions__hint">
        {strings.sessions.count(visible.length)} · {strings.sessions.hint}
      </p>
    </section>
  )
}
