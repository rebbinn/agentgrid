import { create } from 'zustand'
import { MAX_PRESETS, type Preset } from '@shared/settings'

interface PresetsState {
  presets: Preset[]
  setPresets: (presets: Preset[]) => void
  savePreset: (preset: Preset) => boolean
  removePreset: (id: string) => void
}

export const usePresetsStore = create<PresetsState>((set, get) => ({
  presets: [],
  setPresets: (presets) => set({ presets: presets.slice(0, MAX_PRESETS) }),
  savePreset: (preset) => {
    const { presets } = get()
    const exists = presets.some((item) => item.id === preset.id)
    if (!exists && presets.length >= MAX_PRESETS) return false
    set({
      presets: exists
        ? presets.map((item) => (item.id === preset.id ? preset : item))
        : [...presets, preset]
    })
    return true
  },
  removePreset: (id) => set((state) => ({ presets: state.presets.filter((item) => item.id !== id) }))
}))
