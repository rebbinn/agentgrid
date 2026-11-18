import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { formatMode, localParent, remoteParent } from '@shared/sftp'
import { formatBytes, formatDateTime } from '../lib/format'
import { TYPEAHEAD_RESET_MS, typeaheadMatch } from '../lib/typeahead'
import { navigate, selectEntry, sftpErrorText } from '../state/sftp-actions'
import { isDirectoryLike, useSftpStore, visibleEntries, type FileEntry, type Listing, type Side } from '../state/sftp-store'
import { strings } from '../strings'
import { Icon } from './Icon'

export const SFTP_DRAG_TYPE = 'application/x-agentgrid-sftp'

export interface DraggedEntries {
  paneId: string
  side: Side
  names: string[]
}

interface SftpFileListProps {
  paneId: string
  side: Side
  label: string
  listing: Listing
  toolbar: ReactNode
  onOpenFile: (entry: FileEntry) => void
  onContextMenu: (position: { x: number; y: number }, entry: FileEntry | null) => void
  onKeyCommand: (key: 'delete' | 'rename', entry: FileEntry) => void
  onDropEntries: (dragged: DraggedEntries) => void
  onDropPaths?: (paths: string[]) => void
}

const texts = strings.sftp

export function enterFileList(list: Element | null | undefined, paneId: string, side: Side): boolean {
  const row = list?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')
  if (!row) return false
  row.focus()
  const name = row.dataset['name']
  const selected = useSftpStore.getState().listings[paneId]?.[side].selected ?? []
  if (name && selected.length === 0) selectEntry(paneId, side, name, 'single', [])
  return true
}

function rowNamed(list: Element, name: string): HTMLElement | undefined {
  return Array.from(list.querySelectorAll<HTMLElement>('[role="option"]')).find((row) => row.dataset['name'] === name)
}

function lastSegment(path: string): string | null {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || null
}

function entryIcon(entry: FileEntry): 'folder' | 'file' | 'link' {
  if (isDirectoryLike(entry)) return 'folder'
  return entry.kind === 'link' ? 'link' : 'file'
}

export function SftpFileList({
  paneId,
  side,
  label,
  listing,
  toolbar,
  onOpenFile,
  onContextMenu,
  onKeyCommand,
  onDropEntries,
  onDropPaths
}: SftpFileListProps) {
  const entries = useMemo(() => visibleEntries(listing), [listing])
  const order = useMemo(() => entries.map((entry) => entry.name), [entries])
  const [pathDraft, setPathDraft] = useState(listing.path)
  const [dropActive, setDropActive] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const typedRef = useRef('')
  const typedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [typed, setTyped] = useState('')
  const pendingFocus = useRef<{ select: string | null } | null>(null)

  const clearTyped = (): void => {
    if (typedTimer.current) clearTimeout(typedTimer.current)
    typedTimer.current = null
    typedRef.current = ''
    setTyped('')
  }

  useEffect(() => setPathDraft(listing.path), [listing.path])
  useEffect(() => clearTyped, [listing.path])

  const parent = side === 'remote' ? remoteParent(listing.path) : localParent(listing.path)
  const canGoUp = side === 'remote' ? listing.path !== '/' : parent !== null

  useEffect(() => {
    const pending = pendingFocus.current
    const list = listRef.current
    if (!pending || !list || listing.status === 'loading') return
    pendingFocus.current = null
    const focused = document.activeElement
    const scope = list.closest('.sftp') ?? list.parentElement
    if (focused && focused !== document.body && !scope?.contains(focused)) return
    const cameFrom = pending.select ? rowNamed(list, pending.select) : undefined
    if (cameFrom && pending.select) {
      cameFrom.focus()
      selectEntry(paneId, side, pending.select, 'single', order)
    } else if (!enterFileList(list, paneId, side)) {
      list.focus()
    }
  }, [listing.status, listing.path, entries, order, paneId, side])

  const goTo = (path: string, select: string | null = null): void => {
    pendingFocus.current = { select }
    void navigate(paneId, side, path)
  }

  const goUp = (): void => {
    if (canGoUp && parent) goTo(parent, lastSegment(listing.path))
  }

  const open = (entry: FileEntry): void => {
    if (isDirectoryLike(entry)) {
      const next = side === 'remote'
        ? (listing.path.endsWith('/') ? listing.path : `${listing.path}/`) + entry.name
        : (listing.path.endsWith('\\') ? listing.path : `${listing.path}\\`) + entry.name
      goTo(next)
    } else {
      onOpenFile(entry)
    }
  }

  const focusRow = (index: number): void => {
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
    const row = rows?.[Math.max(0, Math.min(index, (rows?.length ?? 1) - 1))]
    row?.focus()
    const name = row?.dataset['name']
    if (name) selectEntry(paneId, side, name, 'single', order)
  }

  const typeAhead = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    if (event.ctrlKey || event.altKey || event.metaKey || [...event.key].length !== 1) return false
    if (event.key === ' ' && typedRef.current === '') return false
    const query = typedRef.current + event.key
    typedRef.current = query
    setTyped(query)
    if (typedTimer.current) clearTimeout(typedTimer.current)
    typedTimer.current = setTimeout(clearTyped, TYPEAHEAD_RESET_MS)
    const index = typeaheadMatch(order, query)
    if (index !== -1) focusRow(index)
    return true
  }

  const handleRowKey = (event: KeyboardEvent<HTMLDivElement>, entry: FileEntry, index: number): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      open(entry)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(index + (event.key === 'ArrowDown' ? 1 : -1))
    } else if (event.key === 'Backspace' && canGoUp && parent) {
      event.preventDefault()
      goUp()
    } else if (event.key === 'Delete') {
      event.preventDefault()
      onKeyCommand('delete', entry)
    } else if (event.key === 'F2') {
      event.preventDefault()
      onKeyCommand('rename', entry)
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      onContextMenu({ x: rect.left + 24, y: rect.bottom }, entry)
    } else if (typeAhead(event)) {
      event.preventDefault()
    }
  }

  const accepts = (event: DragEvent<HTMLElement>): boolean => {
    const types = Array.from(event.dataTransfer.types)
    return types.includes(SFTP_DRAG_TYPE) || (onDropPaths !== undefined && types.includes('Files'))
  }

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    setDropActive(false)
    if (!accepts(event)) return
    event.preventDefault()
    const raw = event.dataTransfer.getData(SFTP_DRAG_TYPE)
    if (raw) {
      try {
        const dragged = JSON.parse(raw) as DraggedEntries
        if (dragged.paneId === paneId && dragged.side !== side) onDropEntries(dragged)
      } catch {
        return
      }
      return
    }
    if (onDropPaths) {
      const paths = Array.from(event.dataTransfer.files)
        .map((file) => window.agentgrid.local.pathForFile(file))
        .filter((path) => path.length > 0)
      if (paths.length > 0) onDropPaths(paths)
    }
  }

  const selectedCount = listing.selected.length

  return (
    <section className="sftp-list" aria-label={label} data-side={side} data-drop={dropActive}>
      <div className="sftp-list__toolbar">
        <span className="sftp-list__label">{label}</span>
        <button
          type="button"
          className="icon-button"
          aria-label={texts.up}
          title={texts.up}
          disabled={!canGoUp}
          onClick={goUp}
        >
          <Icon name="up" size={14} />
        </button>
        <form
          className="sftp-list__path"
          onSubmit={(event) => {
            event.preventDefault()
            if (pathDraft.trim()) void navigate(paneId, side, pathDraft.trim())
          }}
        >
          <input
            className="sftp-list__path-input"
            aria-label={texts.pathLabel(label)}
            value={pathDraft}
            spellCheck={false}
            onChange={(event) => setPathDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return
              if (enterFileList(listRef.current, paneId, side)) event.preventDefault()
            }}
          />
        </form>
        <button
          type="button"
          className="icon-button"
          aria-label={texts.refresh}
          title={texts.refresh}
          onClick={() => void navigate(paneId, side, listing.path)}
        >
          <Icon name="restart" size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={texts.showHidden}
          title={texts.showHidden}
          aria-pressed={listing.showHidden}
          onClick={() => useSftpStore.getState().setListing(paneId, side, { showHidden: !listing.showHidden })}
        >
          <span className="sftp-list__dot" aria-hidden="true">.*</span>
        </button>
        {toolbar}
      </div>

      <div className="sftp-list__head" aria-hidden="true">
        <span>{texts.columns.name}</span>
        <span>{texts.columns.size}</span>
        <span>{texts.columns.modified}</span>
        {side === 'remote' && <span>{texts.columns.mode}</span>}
      </div>

      <div
        ref={listRef}
        className="sftp-list__rows"
        role="listbox"
        tabIndex={-1}
        aria-multiselectable="true"
        aria-label={texts.listLabel(label)}
        data-side={side}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Backspace' && canGoUp) {
            event.preventDefault()
            goUp()
          } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && enterFileList(listRef.current, paneId, side)) {
            event.preventDefault()
          }
        }}
        onDragOver={(event) => {
          if (!accepts(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropActive(true)
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('[role="option"]')) return
          event.preventDefault()
          onContextMenu({ x: event.clientX, y: event.clientY }, null)
        }}
      >
        {listing.status === 'error' && (
          <p className="sftp-list__message" role="alert">
            {sftpErrorText(listing.error)} {listing.error?.message}
          </p>
        )}
        {listing.status === 'loading' && entries.length === 0 && <p className="sftp-list__message">{texts.loading}</p>}
        {listing.status === 'ready' && entries.length === 0 && (
          <p className="sftp-list__message">{onDropPaths ? texts.dropHint : texts.empty}</p>
        )}
        {entries.map((entry, index) => {
          const selected = listing.selected.includes(entry.name)
          return (
            <div
              key={entry.name}
              role="option"
              tabIndex={selected || (listing.selected.length === 0 && index === 0) ? 0 : -1}
              aria-selected={selected}
              aria-label={entry.name}
              data-name={entry.name}
              className="sftp-row"
              draggable
              title={entry.target ? `${entry.name} → ${entry.target}` : entry.name}
              onMouseDown={(event) => {
                if (event.button !== 0 && selected) return
                selectEntry(paneId, side, entry.name, event.shiftKey ? 'range' : event.ctrlKey ? 'toggle' : 'single', order)
              }}
              onDoubleClick={() => open(entry)}
              onKeyDown={(event) => handleRowKey(event, entry, index)}
              onContextMenu={(event) => {
                event.preventDefault()
                onContextMenu({ x: event.clientX, y: event.clientY }, entry)
              }}
              onDragStart={(event) => {
                const names = selected ? listing.selected : [entry.name]
                event.dataTransfer.setData(SFTP_DRAG_TYPE, JSON.stringify({ paneId, side, names }))
                event.dataTransfer.effectAllowed = 'copy'
              }}
            >
              <span className="sftp-row__name">
                <span className="sftp-row__icon" data-kind={isDirectoryLike(entry) ? 'dir' : entry.kind}>
                  <Icon name={entryIcon(entry)} size={13} />
                </span>
                <span className="sftp-row__text">{entry.name}</span>
              </span>
              <span className="sftp-row__size">{isDirectoryLike(entry) ? '' : formatBytes(entry.size)}</span>
              <span className="sftp-row__date">{formatDateTime(entry.mtime)}</span>
              {side === 'remote' && (
                <span className="sftp-row__mode">{entry.mode !== undefined ? formatMode(entry.mode) : ''}</span>
              )}
            </div>
          )
        })}
      </div>

      <p className="sftp-list__footer" data-typing={typed !== ''}>
        {typed !== ''
          ? texts.typeahead(typed, typeaheadMatch(order, typed) !== -1)
          : selectedCount > 0
            ? texts.selection(selectedCount)
            : texts.items(entries.length)}
      </p>
    </section>
  )
}
