import {
  joinLocal,
  joinRemote,
  type SftpError,
  type SftpEvent,
  type SftpRequest
} from '@shared/sftp'
import { strings } from '../strings'
import {
  emptyListing,
  useSftpStore,
  type EditSession,
  type FileEntry,
  type Side,
  type TransferItem
} from './sftp-store'
import { useTerminalStore } from './terminal-store'
import { useUiStore } from './ui-store'

export interface PlannedTransfer {
  direction: 'upload' | 'download'
  name: string
  localPath: string
  remotePath: string
  targetDirectory: string
}

function listingOf(paneId: string, side: Side) {
  return useSftpStore.getState().listings[paneId]?.[side] ?? emptyListing()
}

export function sftpErrorText(error: SftpError | undefined): string {
  if (!error) return ''
  return strings.sftp.errors[error.code]
}

export async function loadRemote(paneId: string, path?: string): Promise<void> {
  const target = path ?? listingOf(paneId, 'remote').path
  if (!target) return
  const store = useSftpStore.getState()
  store.setListing(paneId, 'remote', { status: 'loading' })
  const reply = await window.agentgrid.sftp
    .request({ sessionId: paneId, op: 'list', path: target })
    .catch(() => ({ ok: false as const, error: { code: 'connection' as const, message: '' } }))
  if (!useSftpStore.getState().listings[paneId]) return
  if (reply.ok) {
    const changed = (reply.path ?? target) !== listingOf(paneId, 'remote').path
    store.setListing(paneId, 'remote', {
      path: reply.path ?? target,
      entries: reply.entries ?? [],
      status: 'ready',
      error: undefined,
      ...(changed ? { selected: [], anchor: null } : {})
    })
  } else {
    store.setListing(paneId, 'remote', { status: 'error', error: reply.error })
  }
}

export async function loadLocal(paneId: string, path?: string): Promise<void> {
  const target = path ?? listingOf(paneId, 'local').path
  if (!target) return
  const store = useSftpStore.getState()
  store.setListing(paneId, 'local', { status: 'loading' })
  const result = await window.agentgrid.local
    .list(target)
    .catch(() => ({ ok: false as const, error: { code: 'failure' as const, message: '' } }))
  if (!useSftpStore.getState().listings[paneId]) return
  if (result.ok) {
    const changed = result.path !== listingOf(paneId, 'local').path
    store.setListing(paneId, 'local', {
      path: result.path,
      entries: result.entries,
      status: 'ready',
      error: undefined,
      ...(changed ? { selected: [], anchor: null } : {})
    })
  } else {
    store.setListing(paneId, 'local', { status: 'error', error: result.error })
  }
}

export async function initSftpPane(paneId: string, home: string): Promise<void> {
  const store = useSftpStore.getState()
  const existing = store.listings[paneId]
  const localPath = existing?.local.path || (await window.agentgrid.local.places().catch(() => null))?.downloads || ''
  store.setListing(paneId, 'local', { path: localPath })
  store.setListing(paneId, 'remote', { path: existing?.remote.path || home })
  await Promise.all([loadRemote(paneId), loadLocal(paneId)])
}

export function navigate(paneId: string, side: Side, path: string): Promise<void> {
  return side === 'remote' ? loadRemote(paneId, path) : loadLocal(paneId, path)
}

export function joinFor(side: Side, directory: string, name: string): string {
  return side === 'remote' ? joinRemote(directory, name) : joinLocal(directory, name)
}

export function selectEntry(paneId: string, side: Side, name: string, mode: 'single' | 'toggle' | 'range', order: string[]): void {
  const listing = listingOf(paneId, side)
  let selected: string[]
  if (mode === 'toggle') {
    selected = listing.selected.includes(name)
      ? listing.selected.filter((item) => item !== name)
      : [...listing.selected, name]
  } else if (mode === 'range' && listing.anchor && order.includes(listing.anchor)) {
    const start = order.indexOf(listing.anchor)
    const end = order.indexOf(name)
    selected = order.slice(Math.min(start, end), Math.max(start, end) + 1)
  } else {
    selected = [name]
  }
  useSftpStore.getState().setListing(paneId, side, { selected, anchor: mode === 'range' ? listing.anchor : name })
}

export function planTransfers(paneId: string, from: Side, names: readonly string[]): PlannedTransfer[] {
  const local = listingOf(paneId, 'local')
  const remote = listingOf(paneId, 'remote')
  if (!local.path || !remote.path) return []
  return names.map((name) =>
    from === 'local'
      ? {
          direction: 'upload',
          name,
          localPath: joinLocal(local.path, name),
          remotePath: joinRemote(remote.path, name),
          targetDirectory: remote.path
        }
      : {
          direction: 'download',
          name,
          localPath: joinLocal(local.path, name),
          remotePath: joinRemote(remote.path, name),
          targetDirectory: local.path
        }
  )
}

export function planUploadOfPaths(paneId: string, paths: readonly string[]): PlannedTransfer[] {
  const remote = listingOf(paneId, 'remote')
  if (!remote.path) return []
  return paths.map((localPath) => {
    const name = localPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? localPath
    return { direction: 'upload', name, localPath, remotePath: joinRemote(remote.path, name), targetDirectory: remote.path }
  })
}

export function findConflicts(paneId: string, planned: readonly PlannedTransfer[]): PlannedTransfer[] {
  return planned.filter((item) => {
    const target = item.direction === 'upload' ? listingOf(paneId, 'remote') : listingOf(paneId, 'local')
    return target.entries.some((entry: FileEntry) => entry.name === item.name)
  })
}

export interface TransferOptions {
  purpose?: TransferItem['purpose']
  resume?: boolean
}

export function startTransfers(
  paneId: string,
  planned: readonly PlannedTransfer[],
  overwrite: boolean,
  options: TransferOptions = {}
): void {
  if (planned.length === 0) return
  const now = Date.now()
  const items: TransferItem[] = planned.map((item) => ({
    direction: item.direction,
    name: item.name,
    localPath: item.localPath,
    remotePath: item.remotePath,
    targetDirectory: item.targetDirectory,
    id: crypto.randomUUID(),
    paneId,
    ...(options.purpose ? { purpose: options.purpose } : {}),
    bytes: 0,
    total: 0,
    files: 0,
    filesTotal: 0,
    current: '',
    state: 'running',
    speed: 0,
    updatedAt: now
  }))
  useSftpStore.getState().addTransfers(items)
  for (const item of items) {
    window.agentgrid.sftp.transfer({
      sessionId: paneId,
      transferId: item.id,
      direction: item.direction,
      localPath: item.localPath,
      remotePath: item.remotePath,
      overwrite,
      ...(options.resume ? { resume: true } : {})
    })
  }
}

export function canResume(item: TransferItem): boolean {
  return item.state === 'failed' && item.error?.code === 'connection' && !item.purpose
}

export function resumeTransfer(item: TransferItem): void {
  useSftpStore.getState().removeTransfer(item.id)
  startTransfers(item.paneId, [item], false, { resume: true })
}

export async function openForEditing(paneId: string, entry: FileEntry): Promise<void> {
  const remote = listingOf(paneId, 'remote')
  let localPath: string
  try {
    localPath = await window.agentgrid.local.editPath(entry.name)
  } catch {
    useUiStore.getState().pushToast('error', strings.sftp.editing.openFailed(entry.name))
    return
  }
  const remotePath = joinRemote(remote.path, entry.name)
  useSftpStore
    .getState()
    .addEdit({ paneId, name: entry.name, remotePath, localPath, state: 'downloading', dirty: false })
  startTransfers(
    paneId,
    [{ direction: 'download', name: entry.name, localPath, remotePath, targetDirectory: '' }],
    true,
    { purpose: 'edit-open' }
  )
}

function uploadEdit(edit: EditSession): void {
  useSftpStore.getState().setEdit(edit.localPath, { state: 'uploading', dirty: false })
  startTransfers(
    edit.paneId,
    [{ direction: 'upload', name: edit.name, localPath: edit.localPath, remotePath: edit.remotePath, targetDirectory: '' }],
    true,
    { purpose: 'edit-save' }
  )
}

export function handleLocalChanged(path: string): void {
  const edit = useSftpStore.getState().edits.find((item) => item.localPath === path)
  if (!edit) return
  if (edit.state === 'watching') uploadEdit(edit)
  else useSftpStore.getState().setEdit(path, { dirty: true })
}

export function stopEditing(edit: EditSession): void {
  window.agentgrid.local.unwatch(edit.localPath)
  useSftpStore.getState().setEdit(edit.localPath, null)
}

export function forgetSftpPane(paneId: string): void {
  for (const edit of useSftpStore.getState().edits) {
    if (edit.paneId === paneId) window.agentgrid.local.unwatch(edit.localPath)
  }
  useSftpStore.getState().forget(paneId)
}

async function finishEditTransfer(item: TransferItem): Promise<void> {
  const store = useSftpStore.getState()
  const edit = store.edits.find((candidate) => candidate.localPath === item.localPath)
  if (!edit) return
  const toast = useUiStore.getState().pushToast
  if (item.purpose === 'edit-open') {
    if (item.state !== 'done') {
      store.setEdit(edit.localPath, null)
      toast('error', strings.sftp.editing.openFailed(edit.name))
      return
    }
    const opened = await window.agentgrid.local.openInEditor(edit.localPath).catch(() => false)
    if (!opened) {
      store.setEdit(edit.localPath, null)
      toast('error', strings.sftp.editing.openFailed(edit.name))
      return
    }
    window.agentgrid.local.watch(edit.localPath)
    store.setEdit(edit.localPath, { state: 'watching' })
    return
  }
  if (item.state === 'done') toast('success', strings.sftp.editing.saved(edit.name))
  else toast('error', strings.sftp.editing.failed(edit.name, sftpErrorText(item.error)))
  store.setEdit(edit.localPath, { state: 'watching' })
  if (edit.dirty) uploadEdit({ ...edit, state: 'watching' })
}

export function cancelTransfer(item: TransferItem): void {
  window.agentgrid.sftp.cancelTransfer(item.paneId, item.id)
}

export async function remoteOperation(paneId: string, request: SftpRequest): Promise<boolean> {
  const reply = await window.agentgrid.sftp
    .request(request)
    .catch(() => ({ ok: false as const, error: { code: 'connection' as const, message: '' } }))
  if (!reply.ok) useUiStore.getState().pushToast('error', sftpErrorText(reply.error))
  await loadRemote(paneId)
  return reply.ok
}

export function handleSftpEvent(event: SftpEvent): void {
  if (event.kind === 'sftp-closed') {
    useTerminalStore.getState().handleExit({ id: event.sessionId, exitCode: 0, reason: event.reason })
    return
  }
  const updated = useSftpStore.getState().handleEvent(event, Date.now())
  if (!updated || updated.state === 'running') return
  if (updated.purpose) {
    void finishEditTransfer(updated)
    if (updated.state === 'done' || updated.state === 'failed') useSftpStore.getState().removeTransfer(updated.id)
    return
  }
  if (updated.state === 'failed') {
    useUiStore.getState().pushToast('error', `${updated.name}: ${sftpErrorText(updated.error)}`)
  }
  const side: Side = updated.direction === 'upload' ? 'remote' : 'local'
  if (listingOf(updated.paneId, side).path === updated.targetDirectory) void navigate(updated.paneId, side, updated.targetDirectory)
}

let unsubscribers: Array<() => void> = []

export function startSftpEvents(): void {
  stopSftpEvents()
  unsubscribers = [
    window.agentgrid.sftp.onEvent(handleSftpEvent),
    window.agentgrid.local.onChanged((event) => handleLocalChanged(event.path))
  ]
}

export function stopSftpEvents(): void {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
}
