import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { MIN_PANE_FRACTION, equalFractions, resizeBoundary } from '../lib/layout'

const KEY_STEP = 0.02
const KEY_STEP_LARGE = 0.1

interface SplitterProps {
  orientation: 'vertical' | 'horizontal'
  index: number
  offset: number
  extent?: number
  fractions: number[]
  label: string
  containerRef: RefObject<HTMLDivElement | null>
  onChange: (fractions: number[]) => void
  onDragStateChange: (dragging: boolean) => void
}

export function Splitter({
  orientation,
  index,
  offset,
  extent = 1,
  fractions,
  label,
  containerRef,
  onChange,
  onDragStateChange
}: SplitterProps) {
  const dragStart = useRef<{ pointer: number; fractions: number[]; size: number } | null>(null)
  const isVertical = orientation === 'vertical'

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current
    if (!container || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const rect = container.getBoundingClientRect()
    dragStart.current = {
      pointer: isVertical ? event.clientX : event.clientY,
      fractions,
      size: isVertical ? rect.width : rect.height
    }
    onDragStateChange(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const start = dragStart.current
    if (!start || start.size === 0) return
    const current = isVertical ? event.clientX : event.clientY
    onChange(resizeBoundary(start.fractions, index, (current - start.pointer) / start.size))
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragStart.current) return
    dragStart.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onDragStateChange(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const decrease = isVertical ? 'ArrowLeft' : 'ArrowUp'
    const increase = isVertical ? 'ArrowRight' : 'ArrowDown'
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    if (event.key === decrease) {
      event.preventDefault()
      onChange(resizeBoundary(fractions, index, -step))
    } else if (event.key === increase) {
      event.preventDefault()
      onChange(resizeBoundary(fractions, index, step))
    } else if (event.key === 'Enter' || event.key === 'Home') {
      event.preventDefault()
      onChange(equalFractions(fractions.length))
    }
  }

  const position = `${offset * 100}%`

  return (
    <div
      className={`splitter splitter--${orientation}`}
      style={isVertical ? { left: position, bottom: 'auto', height: `${extent * 100}%` } : { top: position }}
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(offset * 100)}
      aria-valuemin={Math.round(MIN_PANE_FRACTION * 100)}
      aria-valuemax={Math.round((1 - MIN_PANE_FRACTION) * 100)}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(equalFractions(fractions.length))}
      onKeyDown={handleKeyDown}
    />
  )
}
