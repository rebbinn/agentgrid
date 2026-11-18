import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Host } from '@shared/hosts'
import { isValidFileName, joinLocal, joinRemote } from '@shared/sftp'
import { formatBytes, formatDuration } from '../lib/format'
import {
  cancelTransfer,
  findConflicts,
  planTransfers,
  planUploadOfPaths,
  remoteOperation,
  startTransfers,
  type PlannedTransfer
} from '../state/sftp-actions'
import { isDirectoryLike, useSftpStore, type FileEntry, type Side, type TransferItem } from '../state/sftp-store'
import { useUiStore } from '../state/ui-store'
import { strings } from '../strings'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu } from './ContextMenu'
import type { DropdownItem } from './Dropdown'
import { Icon } from './Icon'
import { PromptDialog } from './PromptDialog'
import { SftpFileList, type DraggedEntries } from './SftpFileList'

const texts = strings.sftp
const MAX_LISTED_NAMES = 3

type SftpDialog =
  | { kind: 'mkdir' }
  | { kind: 'rename'; entry: FileEntry }
  | { kind: 'chmod'; entry: FileEntry }
  | { kind: 'delete'; entries: FileEntry[] }
  | { kind: 'overwrite'; planned: PlannedTransfer[]; conflicts: PlannedTransfer[] }

interface MenuState {
  x: number
  y: number
  side: Side
  entry: FileEntry | null
}

function nameList(names: readonly string[]): string {
  const shown = names.slice(0, MAX_LISTED_NAMES).map((name) => `"${name}"`).join(', ')
  return names.length > MAX_LISTED_NAMES ? `${shown} +${names.length - MAX_LISTED_NAMES}` : shown
}

function TransferRow({ item }: { item: TransferItem }) {
  const percent = item.total > 0 ? Math.min(100, (item.bytes / item.total) * 100) : item.state === 'done' ? 100 : 0
  const remaining = item.speed > 0 ? (item.total - item.bytes) / item.speed : Number.NaN
  const t = texts.transfers
  return (
    <li className="transfer" data-state={item.state}>
      <Icon name={item.direction === 'upload' ? 'upload' : 'download'} size={13} />
      <span className="transfer__name" title={item.current || item.name}>
        {item.name}
      </span>
      <span className="transfer__bar" role="progressbar" aria-label={item.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <span className="transfer__fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="transfer__info">
        {item.state === 'running' ? (
          item.total === 0 ? (
            t.waiting
          ) : (
            <>
              {formatBytes(item.bytes)} / {formatBytes(item.total)}
              {item.filesTotal > 1 && <> · {t.files(item.files, item.filesTotal)}</>}
              {item.speed > 0 && (
                <>
                  {' '}
                  · {t.speed(formatBytes(item.speed))} · {t.left(formatDuration(remaining))}
                </>
              )}
            </>
          )
        ) : item.state === 'done' ? (
          `${t.done} · ${formatBytes(item.total)}`
        ) : item.state === 'cancelled' ? (
          t.cancelled
        ) : (
          t.failed(item.error ? strings.sftp.errors[item.error.code] : '')
        )}
      </span>
      {item.state === 'running' && (
        <button type="button" className="icon-button" aria-label={t.cancel(item.name)} title={t.cancel(item.name)} onClick={() => cancelTransfer(item)}>
          <Icon name="close" size={12} />
        </button>
      )}
    </li>
  )
}

function TransferQueue({ paneId }: { paneId: string }) {
  const transfers = useSftpStore((state) => state.transfers)
  const mine = transfers.filter((item) => item.paneId === paneId)
  if (mine.length === 0) return null
  const finished = mine.some((item) => item.state !== 'running')
  return (
    <section className="sftp-queue" aria-label={texts.transfers.label}>
      <div className="sftp-queue__head">
        <span>{texts.transfers.label}</span>
        <span className="sftp-queue__spacer" />
        {finished && (
          <button type="button" className="link-button" onClick={() => useSftpStore.getState().clearFinished(paneId)}>
            {texts.transfers.clear}
          </button>
        )}
      </div>
      <ul className="sftp-queue__list">
        {[...mine].reverse().map((item) => (
          <TransferRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  )
}

export function SftpView({ paneId, host }: { paneId: string; host: Host | undefined }) {
  const listings = useSftpStore((state) => state.listings[paneId])
  const pushToast = useUiStore((state) => state.pushToast)
  const [dialog, setDialog] = useState<SftpDialog | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  if (!listings) return null
  const { local, remote } = listings

  const entriesOf = (side: Side, names: readonly string[]): FileEntry[] => {
    const listing = side === 'local' ? local : remote
    return listing.entries.filter((entry) => names.includes(entry.name))
  }

  const requestTransfer = (planned: PlannedTransfer[]): void => {
    if (planned.length === 0) return
    const conflicts = findConflicts(paneId, planned)
    if (conflicts.length === 0) startTransfers(paneId, planned, false)
    else setDialog({ kind: 'overwrite', planned, conflicts })
  }

  const transferNames = (from: Side, names: readonly string[]): void => requestTransfer(planTransfers(paneId, from, names))

  const selectionOr = (side: Side, entry: FileEntry | null): string[] => {
    const listing = side === 'local' ? local : remote
    if (entry && !listing.selected.includes(entry.name)) return [entry.name]
    return entry ? listing.selected : []
  }

  const askDelete = (names: readonly string[]): void => {
    const entries = entriesOf('remote', names)
    if (entries.length > 0) setDialog({ kind: 'delete', entries })
  }

  const copyPath = (path: string): void => {
    void window.agentgrid.clipboard.writeText(path).then(() => pushToast('success', texts.pathCopied))
  }

  const menuItems = (state: MenuState): DropdownItem[] => {
    const names = selectionOr(state.side, state.entry)
    if (state.side === 'local') {
      return [
        ...(names.length > 0
          ? [
              { id: 'upload', label: texts.upload, icon: <Icon name="upload" size={14} />, onSelect: () => transferNames('local', names) },
              {
                id: 'reveal',
                label: texts.reveal,
                onSelect: () => void window.agentgrid.local.reveal(joinLocal(local.path, names[0]!))
              }
            ]
          : []),
        { id: 'copy-path', label: texts.copyPath, onSelect: () => copyPath(state.entry ? joinLocal(local.path, state.entry.name) : local.path) }
      ]
    }
    const single = names.length === 1 ? entriesOf('remote', names)[0] : undefined
    return [
      ...(names.length > 0
        ? [{ id: 'download', label: texts.download, icon: <Icon name="download" size={14} />, onSelect: () => transferNames('remote', names) }]
        : [{ id: 'mkdir', label: texts.newFolder, onSelect: () => setDialog({ kind: 'mkdir' }) }]),
      ...(single
        ? [
            { id: 'rename', label: texts.rename, hint: 'F2', separatorBefore: true, onSelect: () => setDialog({ kind: 'rename', entry: single }) },
            { id: 'chmod', label: texts.permissions, onSelect: () => setDialog({ kind: 'chmod', entry: single }) }
          ]
        : []),
      {
        id: 'copy-path',
        label: texts.copyPath,
        onSelect: () => copyPath(state.entry ? joinRemote(remote.path, state.entry.name) : remote.path)
      },
      ...(names.length > 0
        ? [{ id: 'delete', label: texts.remove, hint: 'Del', separatorBefore: true, onSelect: () => askDelete(names) }]
        : [])
    ]
  }

  const pickAndUpload = async (): Promise<void> => {
    const { paths } = await window.agentgrid.local.pickFiles().catch(() => ({ paths: [] as string[] }))
    requestTransfer(planUploadOfPaths(paneId, paths))
  }

  const remoteName = host?.name ?? texts.remote

  return (
    <div className="sftp">
      <div className="sftp__columns">
        <SftpFileList
          paneId={paneId}
          side="local"
          label={texts.local}
          listing={local}
          toolbar={
            <button
              type="button"
              className="btn btn--compact"
              disabled={local.selected.length === 0}
              onClick={() => transferNames('local', local.selected)}
            >
              {texts.upload}
              <Icon name="arrowRight" size={13} />
            </button>
          }
          onOpenFile={(entry) => transferNames('local', [entry.name])}
          onContextMenu={(position, entry) => setMenu({ ...position, side: 'local', entry })}
          onKeyCommand={() => undefined}
          onDropEntries={(dragged: DraggedEntries) => transferNames('remote', dragged.names)}
        />
        <SftpFileList
          paneId={paneId}
          side="remote"
          label={remoteName}
          listing={remote}
          toolbar={
            <>
              <button type="button" className="icon-button" aria-label={texts.newFolder} title={texts.newFolder} onClick={() => setDialog({ kind: 'mkdir' })}>
                <Icon name="plus" size={14} />
              </button>
              <button type="button" className="icon-button" aria-label={texts.uploadPick} title={texts.uploadPick} onClick={() => void pickAndUpload()}>
                <Icon name="upload" size={14} />
              </button>
              <button
                type="button"
                className="btn btn--compact"
                disabled={remote.selected.length === 0}
                onClick={() => transferNames('remote', remote.selected)}
              >
                <Icon name="arrowLeft" size={13} />
                {texts.download}
              </button>
            </>
          }
          onOpenFile={(entry) => transferNames('remote', [entry.name])}
          onContextMenu={(position, entry) => setMenu({ ...position, side: 'remote', entry })}
          onKeyCommand={(key, entry) => {
            if (key === 'delete') askDelete(selectionOr('remote', entry))
            else setDialog({ kind: 'rename', entry })
          }}
          onDropEntries={(dragged) => transferNames('local', dragged.names)}
          onDropPaths={(paths) => requestTransfer(planUploadOfPaths(paneId, paths))}
        />
      </div>

      <TransferQueue paneId={paneId} />

      {createPortal(
        <>
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              label={menu.side === 'local' ? texts.local : remoteName}
              items={menuItems(menu)}
              onClose={closeMenu}
            />
          )}

          {dialog?.kind === 'mkdir' && (
            <PromptDialog
              title={texts.dialogs.newFolderTitle}
              label={texts.dialogs.nameLabel}
              initialValue=""
              confirmLabel={texts.dialogs.create}
              cancelLabel={texts.dialogs.cancel}
              maxLength={255}
              validate={(value) => (isValidFileName(value.trim()) ? null : texts.dialogs.nameInvalid)}
              onCancel={() => setDialog(null)}
              onSubmit={(value) => {
                setDialog(null)
                void remoteOperation(paneId, { sessionId: paneId, op: 'mkdir', path: joinRemote(remote.path, value.trim()) })
              }}
            />
          )}

          {dialog?.kind === 'rename' && (
            <PromptDialog
              title={texts.dialogs.renameTitle}
              label={texts.dialogs.nameLabel}
              initialValue={dialog.entry.name}
              confirmLabel={texts.dialogs.save}
              cancelLabel={texts.dialogs.cancel}
              maxLength={255}
              validate={(value) => (isValidFileName(value.trim()) ? null : texts.dialogs.nameInvalid)}
              onCancel={() => setDialog(null)}
              onSubmit={(value) => {
                const from = joinRemote(remote.path, dialog.entry.name)
                setDialog(null)
                if (value.trim() === dialog.entry.name) return
                void remoteOperation(paneId, { sessionId: paneId, op: 'rename', from, to: joinRemote(remote.path, value.trim()) })
              }}
            />
          )}

          {dialog?.kind === 'chmod' && (
            <PromptDialog
              title={`${texts.dialogs.chmodTitle}: ${dialog.entry.name}`}
              label={texts.dialogs.chmodLabel}
              initialValue={((dialog.entry.mode ?? 0o644) & 0o7777).toString(8).padStart(3, '0')}
              confirmLabel={texts.dialogs.save}
              cancelLabel={texts.dialogs.cancel}
              maxLength={4}
              validate={(value) => (/^[0-7]{3,4}$/.test(value.trim()) ? null : texts.dialogs.chmodInvalid)}
              onCancel={() => setDialog(null)}
              onSubmit={(value) => {
                const path = joinRemote(remote.path, dialog.entry.name)
                setDialog(null)
                void remoteOperation(paneId, { sessionId: paneId, op: 'chmod', path, mode: parseInt(value.trim(), 8) })
              }}
            />
          )}

          {dialog?.kind === 'delete' && (
            <ConfirmDialog
              title={texts.dialogs.deleteTitle}
              text={texts.dialogs.deleteText(
                nameList(dialog.entries.map((entry) => entry.name)),
                dialog.entries.filter((entry) => entry.kind === 'dir').length
              )}
              confirmLabel={texts.dialogs.delete}
              cancelLabel={texts.dialogs.cancel}
              onCancel={() => setDialog(null)}
              onConfirm={() => {
                const entries = dialog.entries
                setDialog(null)
                void (async () => {
                  for (const entry of entries) {
                    const ok = await remoteOperation(paneId, {
                      sessionId: paneId,
                      op: 'remove',
                      path: joinRemote(remote.path, entry.name),
                      recursive: entry.kind === 'dir' && isDirectoryLike(entry)
                    })
                    if (!ok) break
                  }
                })()
              }}
            />
          )}

          {dialog?.kind === 'overwrite' && (
            <div className="dialog-backdrop" onMouseDown={() => setDialog(null)}>
              <div
                className="dialog"
                role="alertdialog"
                aria-modal="true"
                aria-label={texts.dialogs.overwriteTitle}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setDialog(null)
                  }
                }}
              >
                <h2 className="dialog__title">{texts.dialogs.overwriteTitle}</h2>
                <p className="dialog__text">
                  {texts.dialogs.overwriteText(dialog.conflicts.length, nameList(dialog.conflicts.map((item) => item.name)))}
                </p>
                <div className="dialog__actions">
                  <button type="button" className="btn" autoFocus onClick={() => setDialog(null)}>
                    {texts.dialogs.cancel}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const skip = new Set(dialog.conflicts.map((item) => item.name))
                      setDialog(null)
                      startTransfers(paneId, dialog.planned.filter((item) => !skip.has(item.name)), false)
                    }}
                  >
                    {texts.dialogs.skip}
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => {
                      setDialog(null)
                      startTransfers(paneId, dialog.planned, true)
                    }}
                  >
                    {texts.dialogs.overwrite}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>,
        document.body
      )}
    </div>
  )
}
