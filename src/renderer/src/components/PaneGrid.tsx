import { useMemo, useRef, useState } from 'react'
import {
  boundaryOffsets,
  normalizeFractions,
  resolveGrid,
  slotPosition
} from '../lib/layout'
import { useLayoutStore } from '../state/layout-store'
import { useTerminalStore } from '../state/terminal-store'
import { strings } from '../strings'
import { EmptySlot } from './EmptySlot'
import { FocusTabs } from './FocusTabs'
import { Splitter } from './Splitter'
import { TerminalPane } from './TerminalPane'

function toTemplate(fractions: number[]): string {
  return fractions.map((fraction) => `${fraction}fr`).join(' ')
}

export function PaneGrid() {
  const panes = useTerminalStore((state) => state.panes)
  const activePaneId = useTerminalStore((state) => state.activePaneId)
  const preset = useLayoutStore((state) => state.preset)
  const focusMode = useLayoutStore((state) => state.focusMode)
  const columnSizes = useLayoutStore((state) => state.columnSizes)
  const rowSizes = useLayoutStore((state) => state.rowSizes)
  const setColumnSizes = useLayoutStore((state) => state.setColumnSizes)
  const setRowSizes = useLayoutStore((state) => state.setRowSizes)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const grid = resolveGrid(preset, panes.length)
  const columns = normalizeFractions(columnSizes, grid.columns)
  const rows = normalizeFractions(rowSizes, grid.rows)

  const domOrder = useMemo(() => [...panes].sort((a, b) => a.seq - b.seq), [panes])
  const slotById = useMemo(() => new Map(panes.map((pane, index) => [pane.id, index])), [panes])

  const emptySlots = focusMode
    ? []
    : Array.from({ length: grid.slots - panes.length }, (_, offset) =>
        slotPosition(panes.length + offset, grid.columns)
      )

  return (
    <div className="pane-area">
      {focusMode && <FocusTabs />}
      <div
        ref={containerRef}
        className="pane-grid"
        data-dragging={dragging}
        style={{
          gridTemplateColumns: focusMode ? '1fr' : toTemplate(columns),
          gridTemplateRows: focusMode ? '1fr' : toTemplate(rows)
        }}
      >
        {domOrder.map((pane) => {
          const position = slotPosition(slotById.get(pane.id) ?? 0, grid.columns)
          return (
            <TerminalPane
              key={pane.id}
              pane={pane}
              active={pane.id === activePaneId}
              column={focusMode ? 1 : position.column}
              row={focusMode ? 1 : position.row}
              focusMode={focusMode}
              hidden={focusMode && pane.id !== activePaneId}
            />
          )
        })}

        {emptySlots.map((position) => (
          <EmptySlot
            key={`slot-${position.row}-${position.column}`}
            column={position.column}
            row={position.row}
          />
        ))}

        {!focusMode &&
          boundaryOffsets(columns).map((offset, index) => (
            <Splitter
              key={`column-${index}`}
              orientation="vertical"
              index={index}
              offset={offset}
              fractions={columns}
              label={strings.layout.columnSplitter(index + 1)}
              containerRef={containerRef}
              onChange={setColumnSizes}
              onDragStateChange={setDragging}
            />
          ))}

        {!focusMode &&
          boundaryOffsets(rows).map((offset, index) => (
            <Splitter
              key={`row-${index}`}
              orientation="horizontal"
              index={index}
              offset={offset}
              fractions={rows}
              label={strings.layout.rowSplitter(index + 1)}
              containerRef={containerRef}
              onChange={setRowSizes}
              onDragStateChange={setDragging}
            />
          ))}
      </div>
    </div>
  )
}
