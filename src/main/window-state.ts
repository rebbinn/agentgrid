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

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

function fitSize(size: number, minimum: number, available: number): number {
  return Math.max(Math.min(size, available), Math.min(minimum, available))
}

function mostVisibleDisplay(placed: Area, displays: readonly Area[]): Area | undefined {
  let best: Area | undefined
  let bestArea = 0
  for (const display of displays) {
    const shared = overlap(placed, display)
    if (shared.width < MIN_VISIBLE_WIDTH || shared.height < MIN_VISIBLE_HEIGHT) continue
    const area = shared.width * shared.height
    if (area > bestArea) {
      best = display
      bestArea = area
    }
  }
  return best
}

export function resolveWindowBounds(
  saved: WindowState | undefined,
  displays: readonly Area[]
): ResolvedBounds {
  if (!saved) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, maximized: false }

  const bounds: ResolvedBounds = {
    width: Math.max(MIN_WIDTH, saved.width),
    height: Math.max(MIN_HEIGHT, saved.height),
    maximized: saved.maximized
  }

  const target =
    saved.x !== undefined && saved.y !== undefined
      ? mostVisibleDisplay({ x: saved.x, y: saved.y, width: bounds.width, height: bounds.height }, displays)
      : undefined

  if (target && saved.x !== undefined && saved.y !== undefined) {
    bounds.width = fitSize(bounds.width, MIN_WIDTH, target.width)
    bounds.height = fitSize(bounds.height, MIN_HEIGHT, target.height)
    bounds.x = clamp(saved.x, target.x, target.x + target.width - bounds.width)
    bounds.y = clamp(saved.y, target.y, target.y + target.height - bounds.height)
    return bounds
  }

  const primary = displays[0]
  if (primary) {
    bounds.width = fitSize(bounds.width, MIN_WIDTH, primary.width)
    bounds.height = fitSize(bounds.height, MIN_HEIGHT, primary.height)
  }
  return bounds
}
