import { describe, expect, it } from 'vitest'
import { autoGridDimensions } from '../../src/renderer/src/lib/auto-grid'

describe('autoGridDimensions', () => {
  it.each([
    [0, 1, 1],
    [1, 1, 1],
    [2, 2, 1],
    [3, 2, 2],
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [7, 3, 3],
    [9, 3, 3],
    [10, 4, 3]
  ])('%i panes use %i columns and %i rows', (count, columns, rows) => {
    expect(autoGridDimensions(count)).toEqual({ columns, rows })
  })

  it('always has room for every pane', () => {
    for (let count = 1; count <= 40; count++) {
      const { columns, rows } = autoGridDimensions(count)
      expect(columns * rows).toBeGreaterThanOrEqual(count)
    }
  })
})
