import { create } from 'zustand'
import type { EntryKind, SftpError, SftpEvent } from '@shared/sftp'

export type Side = 'local' | 'remote'

export interface FileEntry {
  name: string
  kind: EntryKind
  size: number
  mtime: number
  mode?: number
  target?: string
  targetKind?: 'file' | 'dir' | 'other'
}

export interface Listing {
  path: string
  entries: FileEntry[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: SftpError
  selected: string[]
  anchor: string | null
  showHidden: boolean
}

export interface TransferItem {
  id: string
  paneId: string
  direction: 'upload' | 'download'
  name: string
  localPath: string
  remotePath: string
  targetDirectory: string
  bytes: number
  total: number
  files: number
  filesTotal: number
  current: string
  state: 'running' | 'done' | 'failed' | 'cancelled'
  error?: SftpError
  speed: number
  updatedAt: number
  purpose?: 'edit-open' | 'edit-save'
}

export interface EditSession {
  paneId: string
  name: string
  remotePath: string
  localPath: string
  state: 'downloading' | 'watching' | 'uploading'
  dirty: boolean
}

interface SftpState {
  listings: Record<string, Record<Side, Listing>>
  transfers: TransferItem[]
  edits: EditSession[]
  follow: Record<string, boolean>
  setListing: (paneId: string, side: Side, patch: Partial<Listing>) => void
  addTransfers: (items: TransferItem[]) => void
  removeTransfer: (id: string) => void
  setEdit: (localPath: string, patch: Partial<EditSession> | null) => void
  addEdit: (edit: EditSession) => void
  setFollow: (paneId: string, follow: boolean) => void
  handleEvent: (event: SftpEvent, now: number) => TransferItem | null
  clearFinished: (paneId: string) => void
  forget: (paneId: string) => void
}

export function emptyListing(path = ''): Listing {
  return { path, entries: [], status: 'idle', selected: [], anchor: null, showHidden: false }
}

const SPEED_SMOOTHING = 0.35

export const useSftpStore = create<SftpState>((set, get) => ({
  listings: {},
  transfers: [],
  edits: [],
  follow: {},

  setListing: (paneId, side, patch) =>
    set((state) => {
      const current = state.listings[paneId] ?? { local: emptyListing(), remote: emptyListing() }
      return { listings: { ...state.listings, [paneId]: { ...current, [side]: { ...current[side], ...patch } } } }
    }),

  addTransfers: (items) => set((state) => ({ transfers: [...state.transfers, ...items] })),

  removeTransfer: (id) => set((state) => ({ transfers: state.transfers.filter((item) => item.id !== id) })),

  addEdit: (edit) =>
    set((state) => ({ edits: [...state.edits.filter((item) => item.localPath !== edit.localPath), edit] })),

  setEdit: (localPath, patch) =>
    set((state) => ({
      edits:
        patch === null
          ? state.edits.filter((item) => item.localPath !== localPath)
          : state.edits.map((item) => (item.localPath === localPath ? { ...item, ...patch } : item))
    })),

  setFollow: (paneId, follow) => set((state) => ({ follow: { ...state.follow, [paneId]: follow } })),

  handleEvent: (event, now) => {
    if (event.kind === 'sftp-closed') return null
    const existing = get().transfers.find((item) => item.id === event.transferId)
    if (!existing) return null
    let updated: TransferItem
    if (event.kind === 'transfer') {
      const seconds = Math.max(0.001, (now - existing.updatedAt) / 1000)
      const instant = Math.max(0, event.bytes - existing.bytes) / seconds
      updated = {
        ...existing,
        bytes: event.bytes,
        total: event.total,
        files: event.files,
        filesTotal: event.filesTotal,
        current: event.current,
        speed: existing.speed === 0 ? instant : existing.speed * (1 - SPEED_SMOOTHING) + instant * SPEED_SMOOTHING,
        updatedAt: now
      }
    } else {
      updated = {
        ...existing,
        state: event.error ? (event.error.code === 'cancelled' ? 'cancelled' : 'failed') : 'done',
        ...(event.error ? { error: event.error } : { bytes: Math.max(existing.bytes, existing.total) }),
        updatedAt: now
      }
    }
    set((state) => ({ transfers: state.transfers.map((item) => (item.id === updated.id ? updated : item)) }))
    return updated
  },

  clearFinished: (paneId) =>
    set((state) => ({
      transfers: state.transfers.filter((item) => item.paneId !== paneId || item.state === 'running')
    })),

  forget: (paneId) =>
    set((state) => {
      const listings = { ...state.listings }
      delete listings[paneId]
      const follow = { ...state.follow }
      delete follow[paneId]
      return {
        listings,
        follow,
        transfers: state.transfers.filter((item) => item.paneId !== paneId),
        edits: state.edits.filter((item) => item.paneId !== paneId)
      }
    })
}))

export function visibleEntries(listing: Listing): FileEntry[] {
  const entries = listing.showHidden ? listing.entries : listing.entries.filter((entry) => !entry.name.startsWith('.'))
  return [...entries].sort((first, second) => {
    const firstDir = isDirectoryLike(first)
    const secondDir = isDirectoryLike(second)
    if (firstDir !== secondDir) return firstDir ? -1 : 1
    return first.name.localeCompare(second.name, 'az', { sensitivity: 'base', numeric: true })
  })
}

export function isDirectoryLike(entry: FileEntry): boolean {
  return entry.kind === 'dir' || (entry.kind === 'link' && entry.targetKind === 'dir')
}
