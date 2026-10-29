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
const small: Area = { x: 0, y: 0, width: 1366, height: 728 }

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

  it('pulls a window that hangs over the screen edge back inside, so no buttons are cut off', () => {
    const left = resolveWindowBounds({ width: 1000, height: 700, x: -300, y: 100, maximized: false }, [primary])
    expect(left.x).toBe(0)
    const right = resolveWindowBounds({ width: 1000, height: 700, x: 1500, y: 100, maximized: false }, [primary])
    expect(right.x).toBe(920)
    const bottom = resolveWindowBounds({ width: 1000, height: 700, x: 100, y: 800, maximized: false }, [primary])
    expect(bottom.y).toBe(340)
  })

  it('shrinks a window that is bigger than the screen it is on', () => {
    const bounds = resolveWindowBounds({ width: 1800, height: 900, x: 0, y: 0, maximized: false }, [small])
    expect(bounds).toMatchObject({ width: 1366, height: 728, x: 0, y: 0 })
  })

  it('shrinks to the primary screen even when no position was saved', () => {
    const bounds = resolveWindowBounds({ width: 1800, height: 900, maximized: false }, [small])
    expect(bounds.width).toBe(1366)
    expect(bounds.height).toBe(728)
    expect(bounds.x).toBeUndefined()
  })

  it('moves a window that spans two monitors fully onto the one where most of it is', () => {
    const mostlyFirst = resolveWindowBounds({ width: 1000, height: 700, x: 1100, y: 0, maximized: false }, [primary, second])
    expect(mostlyFirst.x).toBe(920)
    const mostlySecond = resolveWindowBounds({ width: 1000, height: 700, x: 1500, y: 0, maximized: false }, [primary, second])
    expect(mostlySecond.x).toBe(1920)
  })

  it('never goes below the minimum size, unless the screen itself is smaller', () => {
    const bounds = resolveWindowBounds({ width: 500, height: 400, x: 0, y: 0, maximized: false }, [primary])
    expect(bounds.width).toBe(MIN_WIDTH)
    expect(bounds.height).toBe(MIN_HEIGHT)
    const tiny: Area = { x: 0, y: 0, width: 640, height: 400 }
    const squeezed = resolveWindowBounds({ width: 500, height: 400, x: 0, y: 0, maximized: false }, [tiny])
    expect(squeezed.width).toBe(640)
    expect(squeezed.height).toBe(400)
  })

  it('works without any known display', () => {
    const bounds = resolveWindowBounds({ width: 1000, height: 700, x: 10, y: 10, maximized: false }, [])
    expect(bounds.x).toBeUndefined()
    expect(bounds.width).toBe(1000)
  })
})
