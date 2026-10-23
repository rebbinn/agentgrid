import { create } from 'zustand'

export type ToastKind = 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface UiState {
  sidebarOpen: boolean
  toasts: Toast[]
  pendingCloseId: string | null
  askToClose: (id: string) => void
  cancelClose: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  pushToast: (kind: ToastKind, message: string) => number
  dismissToast: (id: number) => void
}

let nextToastId = 1

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toasts: [],
  pendingCloseId: null,
  askToClose: (id) => set({ pendingCloseId: id }),
  cancelClose: () => set({ pendingCloseId: null }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  pushToast: (kind, message) => {
    const id = nextToastId++
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
    return id
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
}))
