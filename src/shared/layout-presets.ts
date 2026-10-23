export const LAYOUT_PRESET_IDS = [
  'auto',
  'single',
  'columns',
  'rows',
  'grid-2x2',
  'grid-3x2',
  'grid-2x3'
] as const

export type LayoutPresetId = (typeof LAYOUT_PRESET_IDS)[number]
