import { create } from 'zustand'
import type { SavedLayout } from '@shared/settings'
import type { LayoutPresetId } from '../lib/layout'

interface LayoutState {
  preset: LayoutPresetId
  focusMode: boolean
  columnSizes: number[]
  rowSizes: number[]
  setPreset: (preset: LayoutPresetId) => void
  setFocusMode: (enabled: boolean) => void
  setColumnSizes: (sizes: number[]) => void
  setRowSizes: (sizes: number[]) => void
  resetSizes: () => void
  applyLayout: (layout: SavedLayout) => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  preset: 'auto',
  focusMode: false,
  columnSizes: [],
  rowSizes: [],
  setPreset: (preset) => set({ preset, focusMode: false }),
  setFocusMode: (focusMode) => set({ focusMode }),
  setColumnSizes: (columnSizes) => set({ columnSizes }),
  setRowSizes: (rowSizes) => set({ rowSizes }),
  resetSizes: () => set({ columnSizes: [], rowSizes: [] }),
  applyLayout: (layout) =>
    set({
      preset: layout.preset,
      focusMode: layout.focusMode,
      columnSizes: [...layout.columnSizes],
      rowSizes: [...layout.rowSizes]
    })
}))

export function captureLayout(): SavedLayout {
  const { preset, focusMode, columnSizes, rowSizes } = useLayoutStore.getState()
  return { preset, focusMode, columnSizes: [...columnSizes], rowSizes: [...rowSizes] }
}
