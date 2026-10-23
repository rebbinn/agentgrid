import { describe, expect, it } from 'vitest'
import {
  LAYOUT_PRESETS,
  MIN_PANE_FRACTION,
  boundaryOffsets,
  equalFractions,
  normalizeFractions,
  resizeBoundary,
  resolveGrid,
  slotPosition
} from '../../src/renderer/src/lib/layout'

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0)

describe('resolveGrid', () => {
  it.each([
    ['single', 1, 1, 1],
    ['columns', 2, 1, 2],
    ['rows', 1, 2, 2],
    ['grid-2x2', 2, 2, 4],
    ['grid-3x2', 3, 2, 6],
    ['grid-2x3', 2, 3, 6]
  ] as const)('%s keeps its shape while the panes fit', (preset, columns, rows, slots) => {
    expect(resolveGrid(preset, 1)).toEqual({ columns, rows, slots, overflowed: false })
  })

  it('keeps empty slots for a fixed layout with fewer panes than room', () => {
    const grid = resolveGrid('grid-2x2', 2)
    expect(grid.slots - 2).toBe(2)
  })

  it('grows on its own when the chosen fixed layout is too small, and says so', () => {
    expect(resolveGrid('columns', 3)).toEqual({ columns: 2, rows: 2, slots: 4, overflowed: true })
    expect(resolveGrid('single', 2)).toEqual({ columns: 2, rows: 1, slots: 2, overflowed: true })
    expect(resolveGrid('grid-2x2', 5)).toMatchObject({ columns: 3, rows: 2, overflowed: true })
  })

  it('follows the pane count in automatic mode and never reports overflow', () => {
    expect(resolveGrid('auto', 1)).toMatchObject({ columns: 1, rows: 1, overflowed: false })
    expect(resolveGrid('auto', 4)).toMatchObject({ columns: 2, rows: 2, overflowed: false })
    expect(resolveGrid('auto', 6)).toMatchObject({ columns: 3, rows: 2, overflowed: false })
  })

  it('always has a slot for every pane', () => {
    for (const preset of LAYOUT_PRESETS) {
      for (let count = 1; count <= 30; count++) {
        expect(resolveGrid(preset.id, count).slots).toBeGreaterThanOrEqual(count)
      }
    }
  })
})

describe('fractions', () => {
  it('splits space equally', () => {
    expect(equalFractions(4)).toEqual([0.25, 0.25, 0.25, 0.25])
  })

  it('falls back to equal sizes when saved sizes do not match the grid', () => {
    expect(normalizeFractions([0.3, 0.7], 3)).toEqual(equalFractions(3))
    expect(normalizeFractions([0.5, 0.2], 2)).toEqual(equalFractions(2))
    expect(normalizeFractions([0, 1], 2)).toEqual(equalFractions(2))
    expect(normalizeFractions([Number.NaN, 1], 2)).toEqual(equalFractions(2))
    expect(normalizeFractions([], 2)).toEqual(equalFractions(2))
  })

  it('keeps valid saved sizes', () => {
    expect(normalizeFractions([0.3, 0.7], 2)).toEqual([0.3, 0.7])
  })

  it('moves a boundary and keeps the total at one', () => {
    const result = resizeBoundary([0.5, 0.5], 0, 0.2)
    expect(result[0]).toBeCloseTo(0.7)
    expect(result[1]).toBeCloseTo(0.3)
    expect(sum(result)).toBeCloseTo(1)
  })

  it('never makes a pane smaller than the minimum', () => {
    const shrunk = resizeBoundary([0.5, 0.5], 0, -5)
    expect(shrunk[0]).toBeCloseTo(MIN_PANE_FRACTION)
    const grown = resizeBoundary([0.5, 0.5], 0, 5)
    expect(grown[1]).toBeCloseTo(MIN_PANE_FRACTION)
  })

  it('only changes the two panes next to the boundary', () => {
    const result = resizeBoundary([0.25, 0.25, 0.5], 1, 0.1)
    expect(result[0]).toBe(0.25)
    expect(result[1]).toBeCloseTo(0.35)
    expect(result[2]).toBeCloseTo(0.4)
  })

  it('ignores a boundary that does not exist', () => {
    expect(resizeBoundary([1], 0, 0.2)).toEqual([1])
    expect(resizeBoundary([0.5, 0.5], 5, 0.2)).toEqual([0.5, 0.5])
  })

  it('does not change the input array', () => {
    const input = [0.5, 0.5]
    resizeBoundary(input, 0, 0.1)
    expect(input).toEqual([0.5, 0.5])
  })

  it('computes where the dividers sit', () => {
    expect(boundaryOffsets([0.25, 0.25, 0.5])).toEqual([0.25, 0.5])
    expect(boundaryOffsets([1])).toEqual([])
  })
})

describe('slotPosition', () => {
  it('places panes left to right, then top to bottom, starting from 1', () => {
    expect(slotPosition(0, 3)).toEqual({ column: 1, row: 1 })
    expect(slotPosition(2, 3)).toEqual({ column: 3, row: 1 })
    expect(slotPosition(3, 3)).toEqual({ column: 1, row: 2 })
    expect(slotPosition(4, 2)).toEqual({ column: 1, row: 3 })
  })
})
