import type { LayoutPresetId } from '@shared/layout-presets'
import { autoGridDimensions } from './auto-grid'

export type { LayoutPresetId }

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

export interface PaneCell {
  column: number
  row: number
  span: number
}

function usedRowCount(paneCount: number, columns: number): number {
  return Math.max(1, Math.ceil(paneCount / columns))
}

export function paneCell(index: number, columns: number, paneCount: number): PaneCell {
  const { column, row } = slotPosition(index, columns)
  const lastRowCount = paneCount - (usedRowCount(paneCount, columns) - 1) * columns
  const isLastPane = index === paneCount - 1
  const span = isLastPane && lastRowCount < columns ? columns - lastRowCount + 1 : 1
  return { column, row, span }
}

export function emptyRowSlots(
  paneCount: number,
  columns: number,
  slots: number
): Array<{ column: number; row: number }> {
  const firstEmpty = usedRowCount(paneCount, columns) * columns
  return Array.from({ length: Math.max(0, slots - firstEmpty) }, (_, offset) =>
    slotPosition(firstEmpty + offset, columns)
  )
}

export function verticalSplitterExtent(
  boundaryIndex: number,
  paneCount: number,
  columns: number,
  rowFractions: readonly number[]
): number {
  const rowsUsed = usedRowCount(paneCount, columns)
  const lastRowCount = paneCount - (rowsUsed - 1) * columns
  if (lastRowCount >= boundaryIndex + 2) return 1
  return rowFractions.slice(0, rowsUsed - 1).reduce((sum, fraction) => sum + fraction, 0)
}
