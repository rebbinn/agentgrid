import { MAX_FONT_SIZE, MIN_FONT_SIZE } from '../terminal/theme'

export function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)))
}
