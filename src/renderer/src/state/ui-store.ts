import { create } from 'zustand'

export type ToastKind = 'success' | 'warning' | 'error'
export type SidebarTab = 'projects' | 'sessions' | 'servers'

export type AppDialog =
  | { kind: 'new-workspace' }
  | { kind: 'rename-workspace'; id: string }
  | { kind: 'delete-workspace'; id: string }
  | { kind: 'settings' }
  | { kind: 'launch' }
  | { kind: 'preset-editor'; id: string | null }
  | { kind: 'delete-preset'; id: string }
  | { kind: 'host-editor'; id: string | null; copyOf?: string }
  | { kind: 'delete-host'; id: string }

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface UiState {
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  sessionsTabOpen: boolean
  serversTabOpen: boolean
  toasts: Toast[]
  pendingCloseId: string | null
  dialog: AppDialog | null
  paletteOpen: boolean
  sendPanelOpen: boolean
  sendDraft: string
  renameRequestId: string | null
  setPaletteOpen: (open: boolean) => void
  setSendPanelOpen: (open: boolean) => void
  setSendDraft: (draft: string) => void
  requestRename: (id: string) => void
  clearRenameRequest: () => void
  openDialog: (dialog: AppDialog) => void
  closeDialog: () => void
  askToClose: (id: string) => void
  cancelClose: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  selectSidebarTab: (tab: SidebarTab) => void
  toggleSessionsTab: () => void
  closeSessionsTab: () => void
  toggleServersTab: () => void
  closeServersTab: () => void
  pushToast: (kind: ToastKind, message: string) => number
  dismissToast: (id: number) => void
}

let nextToastId = 1

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  sidebarTab: 'projects',
  sessionsTabOpen: false,
  serversTabOpen: false,
  toasts: [],
  pendingCloseId: null,
  dialog: null,
  paletteOpen: false,
  sendPanelOpen: false,
  sendDraft: '',
  renameRequestId: null,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSendPanelOpen: (sendPanelOpen) => set({ sendPanelOpen }),
  setSendDraft: (sendDraft) => set({ sendDraft }),
  requestRename: (renameRequestId) => set({ renameRequestId }),
  clearRenameRequest: () => set({ renameRequestId: null }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  askToClose: (id) => set({ pendingCloseId: id }),
  cancelClose: () => set({ pendingCloseId: null }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  selectSidebarTab: (tab) => set({ sidebarTab: tab }),
  toggleSessionsTab: () =>
    set((state) => {
      const visible = state.sidebarOpen && state.sessionsTabOpen && state.sidebarTab === 'sessions'
      if (visible) return { sessionsTabOpen: false, sidebarTab: 'projects' }
      return { sessionsTabOpen: true, sidebarTab: 'sessions', sidebarOpen: true }
    }),
  closeSessionsTab: () =>
    set((state) => ({
      sessionsTabOpen: false,
      sidebarTab: state.sidebarTab === 'sessions' ? 'projects' : state.sidebarTab
    })),
  toggleServersTab: () =>
    set((state) => {
      const visible = state.sidebarOpen && state.serversTabOpen && state.sidebarTab === 'servers'
      if (visible) return { serversTabOpen: false, sidebarTab: 'projects' }
      return { serversTabOpen: true, sidebarTab: 'servers', sidebarOpen: true }
    }),
  closeServersTab: () =>
    set((state) => ({
      serversTabOpen: false,
      sidebarTab: state.sidebarTab === 'servers' ? 'projects' : state.sidebarTab
    })),
  pushToast: (kind, message) => {
    const id = nextToastId++
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
    return id
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}))
