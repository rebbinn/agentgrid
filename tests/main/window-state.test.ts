import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  resolveWindowBounds,
  type Area
} from '../../src/main/window-state'

const primary: Area = { x: 0, y: 0, width: 1920, height: 1040 }
const second: Area = { x: 1920, y: 0, width: 1920, height: 1040 }

describe('resolveWindowBounds', () => {
  it('uses the default size on first launch', () => {
    expect(resolveWindowBounds(undefined, [primary])).toEqual({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      maximized: false
    })
  })

  it('restores the saved size and position', () => {
    expect(
      resolveWindowBounds({ width: 1000, height: 700, x: 100, y: 50, maximized: false }, [primary])
    ).toEqual({ width: 1000, height: 700, x: 100, y: 50, maximized: false })
  })

  it('remembers that the window was maximized', () => {
    expect(resolveWindowBounds({ width: 1000, height: 700, maximized: true }, [primary]).maximized).toBe(true)
  })

  it('drops the position when the monitor it was on is gone', () => {
    const bounds = resolveWindowBounds({ width: 1000, height: 700, x: 2500, y: 100, maximized: false }, [primary])
    expect(bounds.x).toBeUndefined()
    expect(bounds.y).toBeUndefined()
    expect(bounds.width).toBe(1000)
  })

  it('keeps the position on a second monitor that is still connected', () => {
    const bounds = resolveWindowBounds({ width: 1000, height: 700, x: 2500, y: 100, maximized: false }, [primary, second])
    expect(bounds.x).toBe(2500)
  })

  it('drops a position that would leave almost nothing visible', () => {
    const bounds = resolveWindowBounds({ width: 1000, height: 700, x: 1880, y: 100, maximized: false }, [primary])
    expect(bounds.x).toBeUndefined()
  })

  it('accepts a window that is only partly on screen but still usable', () => {
    const bounds = resolveWindowBounds({ width: 1000, height: 700, x: -300, y: 100, maximized: false }, [primary])
    expect(bounds.x).toBe(-300)
  })

  it('never goes below the minimum size', () => {
    const bounds = resolveWindowBounds({ width: 500, height: 400, x: 0, y: 0, maximized: false }, [primary])
    expect(bounds.width).toBe(MIN_WIDTH)
    expect(bounds.height).toBe(MIN_HEIGHT)
  })

  it('works without any known display', () => {
    expect(resolveWindowBounds({ width: 1000, height: 700, x: 10, y: 10, maximized: false }, []).x).toBeUndefined()
  })
})
