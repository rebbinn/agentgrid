import type { LayoutPresetId } from '../lib/layout'
import { findPreset } from '../lib/layout'

const SIZE = 16
const GAP = 1.5

export function LayoutGlyph({ preset }: { preset: LayoutPresetId }) {
  const { columns, rows } = findPreset(preset)
  const cells = preset === 'auto' ? { columns: 2, rows: 2 } : { columns, rows }
  const width = (SIZE - GAP * (cells.columns - 1)) / cells.columns
  const height = (SIZE - GAP * (cells.rows - 1)) / cells.rows

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
      {Array.from({ length: cells.rows }, (_, row) =>
        Array.from({ length: cells.columns }, (_, column) => (
          <rect
            key={`${row}-${column}`}
            x={column * (width + GAP)}
            y={row * (height + GAP)}
            width={width}
            height={height}
            rx={1.5}
            fill="currentColor"
            opacity={preset === 'auto' && row + column === 1 ? 0.35 : 0.9}
          />
        ))
      )}
    </svg>
  )
}
