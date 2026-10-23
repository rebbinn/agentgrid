import { autoGridDimensions } from './auto-grid'

export type LayoutPresetId =
  | 'auto'
  | 'single'
  | 'columns'
  | 'rows'
  | 'grid-2x2'
  | 'grid-3x2'
  | 'grid-2x3'

export interface LayoutPreset {
  id: LayoutPresetId
  columns: number
  rows: number
}

export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  { id: 'auto', columns: 0, rows: 0 },
  { id: 'single', columns: 1, rows: 1 },
  { id: 'columns', columns: 2, rows: 1 },
  { id: 'rows', columns: 1, rows: 2 },
  { id: 'grid-2x2', columns: 2, rows: 2 },
  { id: 'grid-3x2', columns: 3, rows: 2 },
  { id: 'grid-2x3', columns: 2, rows: 3 }
]

export const MIN_PANE_FRACTION = 0.1

export interface ResolvedGrid {
  columns: number
  rows: number
  slots: number
  overflowed: boolean
}

export function findPreset(id: LayoutPresetId): LayoutPreset {
  const preset = LAYOUT_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Unknown layout preset: ${id}`)
  return preset
}

export function resolveGrid(presetId: LayoutPresetId, paneCount: number): ResolvedGrid {
  const preset = findPreset(presetId)
  if (preset.id !== 'auto' && paneCount <= preset.columns * preset.rows) {
    return {
      columns: preset.columns,
      rows: preset.rows,
      slots: preset.columns * preset.rows,
      overflowed: false
    }
  }
  const { columns, rows } = autoGridDimensions(paneCount)
  return { columns, rows, slots: columns * rows, overflowed: preset.id !== 'auto' }
}

export function equalFractions(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count)
}

export function normalizeFractions(fractions: readonly number[], count: number): number[] {
  const valid =
    fractions.length === count &&
    fractions.every((value) => Number.isFinite(value) && value > 0) &&
    Math.abs(fractions.reduce((sum, value) => sum + value, 0) - 1) < 1e-6
  return valid ? [...fractions] : equalFractions(count)
}

export function resizeBoundary(
  fractions: readonly number[],
  boundaryIndex: number,
  delta: number,
  minimum: number = MIN_PANE_FRACTION
): number[] {
  const before = fractions[boundaryIndex]
  const after = fractions[boundaryIndex + 1]
  if (before === undefined || after === undefined) return [...fractions]
  const total = before + after
  const nextBefore = Math.min(Math.max(before + delta, minimum), total - minimum)
  const result = [...fractions]
  result[boundaryIndex] = nextBefore
  result[boundaryIndex + 1] = total - nextBefore
  return result
}

export function boundaryOffsets(fractions: readonly number[]): number[] {
  const offsets: number[] = []
  let sum = 0
  for (let index = 0; index < fractions.length - 1; index++) {
    sum += fractions[index] ?? 0
    offsets.push(sum)
  }
  return offsets
}

export function slotPosition(index: number, columns: number): { column: number; row: number } {
  return { column: (index % columns) + 1, row: Math.floor(index / columns) + 1 }
}
