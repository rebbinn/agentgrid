import { create } from 'zustand'
import { DEFAULT_TERMINAL_FONT_SIZE } from '@shared/settings'
import { clampFontSize } from '../lib/font-size'

interface PrefsState {
  defaultFontSize: number
  defaultShellId: string | null
  setDefaultFontSize: (size: number) => void
  setDefaultShellId: (id: string | null) => void
}

export const usePrefsStore = create<PrefsState>((set) => ({
  defaultFontSize: DEFAULT_TERMINAL_FONT_SIZE,
  defaultShellId: null,
  setDefaultFontSize: (size) => set({ defaultFontSize: clampFontSize(size) }),
  setDefaultShellId: (defaultShellId) => set({ defaultShellId })
}))
