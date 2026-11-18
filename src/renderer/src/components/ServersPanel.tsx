import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { endpointLabel, type HostView, type HostsTransferResult } from '@shared/hosts'
import { filterHosts, groupHosts } from '../lib/hosts'
import { formatRelativeTime } from '../lib/time'
import { useHostsStore } from '../state/hosts-store'
import { useTerminalStore } from '../state/terminal-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { ContextMenu } from './ContextMenu'
import { Dropdown, type DropdownItem } from './Dropdown'
import { EnvironmentBadge } from './EnvironmentBadge'
import { Icon } from './Icon'

interface MenuState {
  x: number
  y: number
  view: HostView
}

const texts = strings.servers

function reportTransfer(result: HostsTransferResult): void {
  const pushToast = useUiStore.getState().pushToast
  switch (result.status) {
    case 'cancelled':
      return
    case 'exported':
      pushToast('success', texts.exported(result.count))
      return
    case 'imported':
      pushToast('success', texts.imported(result.added, result.skipped, result.invalid))
      return
    case 'failed':
      pushToast('error', texts.transferFailed[result.reason])
  }
}

export function openHostTerminal(hostId: string): void {
  useTerminalStore.getState().launchSsh(hostId)
}

export function ServersPanel() {
  const views = useHostsStore((state) => state.views)
  const status = useHostsStore((state) => state.status)
  const query = useHostsStore((state) => state.query)
  const collapsed = useHostsStore((state) => state.collapsedGroups)
  const load = useHostsStore((state) => state.load)
  const setQuery = useHostsStore((state) => state.setQuery)
  const toggleGroup = useHostsStore((state) => state.toggleGroup)
  const openDialog = useUiStore((state) => state.openDialog)
  const pushToast = useUiStore((state) => state.pushToast)
  const panes = useTerminalStore((state) => state.panes)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void load()
  }, [load])

  const connected = useMemo(() => {
    const ids = new Set<string>()
    for (const pane of panes) if (pane.sshHostId && pane.status === 'running') ids.add(pane.sshHostId)
    return ids
  }, [panes])

  const groups = useMemo(() => groupHosts(filterHosts(views, query)), [views, query])
  const searching = query.trim().length > 0
  const nameById = useMemo(() => new Map(views.map((view) => [view.host.id, view.host.name])), [views])
  const closeMenu = useCallback(() => setMenu(null), [])

  const transfer = async (action: () => Promise<HostsTransferResult>): Promise<void> => {
    try {
      const result = await action()
      reportTransfer(result)
      if (result.status === 'imported') await useHostsStore.getState().refresh()
    } catch {
      pushToast('error', texts.transferFailed.read)
    }
  }

  const listMenu: DropdownItem[] = [
    {
      id: 'export',
      label: texts.exportAll,
      icon: <Icon name="upload" size={14} />,
      disabled: views.length === 0,
      onSelect: () => void transfer(() => window.agentgrid.hosts.exportAll())
    },
    {
      id: 'import',
      label: texts.importFile,
      icon: <Icon name="download" size={14} />,
      onSelect: () => void transfer(() => window.agentgrid.hosts.importFile())
    }
  ]

  const rowMenu = (view: HostView): DropdownItem[] => [
    {
      id: 'open',
      label: texts.openTerminal,
      hint: 'Enter',
      onSelect: () => openHostTerminal(view.host.id)
    },
    {
      id: 'edit',
      label: texts.edit,
      separatorBefore: true,
      onSelect: () => openDialog({ kind: 'host-editor', id: view.host.id })
    },
    {
      id: 'duplicate',
      label: texts.duplicate,
      onSelect: () => openDialog({ kind: 'host-editor', id: null, copyOf: view.host.id })
    },
    {
      id: 'copy',
      label: texts.copyAddress,
      onSelect: () => {
        void window.agentgrid.clipboard
          .writeText(view.host.address)
          .then(() => pushToast('success', texts.addressCopied))
      }
    },
    {
      id: 'delete',
      label: texts.remove,
      separatorBefore: true,
      onSelect: () => openDialog({ kind: 'delete-host', id: view.host.id })
    }
  ]

  const openMenuAt = (event: MouseEvent<HTMLElement>, view: HostView): void => {
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, view })
  }

  const focusRow = (offset: number): void => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('.server-row__main') ?? [])
    const index = rows.indexOf(document.activeElement as HTMLElement)
    const next = index === -1 ? (offset > 0 ? 0 : rows.length - 1) : index + offset
    if (next < 0) searchRef.current?.focus()
    else rows[Math.min(next, rows.length - 1)]?.focus()
  }

  const handleListKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(-1)
    }
  }

  const handleRowKey = (event: KeyboardEvent<HTMLButtonElement>, view: HostView): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      openHostTerminal(view.host.id)
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      setMenu({ x: rect.left + 24, y: rect.bottom, view })
    }
  }

  return (
    <section className="servers" aria-label={texts.tab} onKeyDown={handleListKey}>
      <div className="servers__toolbar">
        <input
          ref={searchRef}
          className="sessions__search servers__search"
          type="search"
          aria-label={texts.searchLabel}
          placeholder={texts.searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={texts.add}
          data-tip={texts.add}
          onClick={() => openDialog({ kind: 'host-editor', id: null })}
        >
          <Icon name="plus" size={16} />
        </button>
        <Dropdown label={texts.menu} items={listMenu} buttonClassName="icon-button" tip={texts.menu}>
          <Icon name="more" size={16} />
        </Dropdown>
      </div>

      <div ref={listRef} className="servers__list" aria-label={texts.listLabel}>
        {status === 'error' && (
          <div className="sessions__error" role="alert">
            <p className="sidebar__empty">{texts.loadFailed}</p>
            <button type="button" className="btn" onClick={() => void load()}>
              {texts.retry}
            </button>
          </div>
        )}

        {status !== 'error' && groups.length === 0 && (
          <div className="servers__empty">
            <p className="sidebar__empty">{searching ? texts.emptySearch : texts.empty}</p>
            {!searching && status === 'ready' && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => openDialog({ kind: 'host-editor', id: null })}
              >
                <Icon name="plus" size={14} />
                {texts.add}
              </button>
            )}
          </div>
        )}

        {groups.map((group) => {
          const groupName = group.name || texts.ungrouped
          const open = searching || !collapsed.includes(group.name)
          return (
            <div key={group.name || '\u0000'} className="server-group">
              <button
                type="button"
                className="server-group__header"
                aria-expanded={open}
                aria-label={texts.groupToggle(groupName, open)}
                onClick={() => toggleGroup(group.name)}
              >
                <span className="server-group__chevron" data-open={open}>
                  <Icon name="chevron" size={12} />
                </span>
                <span className="server-group__name">{groupName}</span>
                <span className="server-group__count">{group.views.length}</span>
              </button>
              {open && (
                <ul className="server-group__list">
                  {group.views.map((view) => {
                    const { host } = view
                    const isConnected = connected.has(host.id)
                    const endpoint = endpointLabel(host)
                    return (
                      <li
                        key={host.id}
                        className="server-row"
                        data-connected={isConnected}
                        data-env={host.environment ?? undefined}
                        onContextMenu={(event) => openMenuAt(event, view)}
                      >
                        <button
                          type="button"
                          className="server-row__main"
                          title={host.note || endpoint}
                          aria-label={`${host.name}, ${endpoint}`}
                          onDoubleClick={() => openHostTerminal(host.id)}
                          onKeyDown={(event) => handleRowKey(event, view)}
                        >
                          <span className="server-row__line">
                            <span className={`dot ${isConnected ? 'dot--running' : 'dot--idle'}`} aria-hidden="true" />
                            <span className="server-row__name">{host.name}</span>
                            {host.environment && <EnvironmentBadge environment={host.environment} />}
                            <span className="server-row__spacer" />
                            <span className="server-row__when">
                              {isConnected
                                ? texts.connected
                                : host.lastConnectedAt
                                  ? formatRelativeTime(host.lastConnectedAt)
                                  : ''}
                            </span>
                          </span>
                          <span className="server-row__endpoint">{endpoint}</span>
                          {host.jumpHostId && (
                            <span className="server-row__jump">
                              {texts.jumpVia(nameById.get(host.jumpHostId) ?? '?')}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          className="icon-button server-row__action"
                          aria-label={texts.openTerminalFor(host.name)}
                          title={texts.openTerminal}
                          onClick={() => openHostTerminal(host.id)}
                        >
                          <Icon name="terminal" size={14} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      <p className="sessions__hint">{texts.count(views.length, connected.size)}</p>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={texts.rowMenu(menu.view.host.name)}
          items={rowMenu(menu.view)}
          onClose={closeMenu}
        />
      )}
    </section>
  )
}
