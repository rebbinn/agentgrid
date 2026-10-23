import type { WindowState } from '@shared/settings'

export interface Area {
  x: number
  y: number
  width: number
  height: number
}

export interface ResolvedBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

export const DEFAULT_WIDTH = 1360
export const DEFAULT_HEIGHT = 860
export const MIN_WIDTH = 720
export const MIN_HEIGHT = 480
const MIN_VISIBLE_WIDTH = 160
const MIN_VISIBLE_HEIGHT = 80

function overlap(window: Area, display: Area): { width: number; height: number } {
  const width = Math.min(window.x + window.width, display.x + display.width) - Math.max(window.x, display.x)
  const height = Math.min(window.y + window.height, display.y + display.height) - Math.max(window.y, display.y)
  return { width, height }
}

export function resolveWindowBounds(
  saved: WindowState | undefined,
  displays: readonly Area[]
): ResolvedBounds {
  if (!saved) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, maximized: false }

  const width = Math.max(MIN_WIDTH, saved.width)
  const height = Math.max(MIN_HEIGHT, saved.height)
  const bounds: ResolvedBounds = { width, height, maximized: saved.maximized }

  if (saved.x !== undefined && saved.y !== undefined) {
    const placed: Area = { x: saved.x, y: saved.y, width, height }
    const visible = displays.some((display) => {
      const shared = overlap(placed, display)
      return shared.width >= MIN_VISIBLE_WIDTH && shared.height >= MIN_VISIBLE_HEIGHT
    })
    if (visible) {
      bounds.x = saved.x
      bounds.y = saved.y
    }
  }
  return bounds
}
