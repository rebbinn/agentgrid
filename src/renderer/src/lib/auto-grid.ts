export interface GridDimensions {
  columns: number
  rows: number
}

export function autoGridDimensions(paneCount: number): GridDimensions {
  if (paneCount <= 1) return { columns: 1, rows: 1 }
  if (paneCount === 2) return { columns: 2, rows: 1 }
  if (paneCount <= 4) return { columns: 2, rows: 2 }
  if (paneCount <= 6) return { columns: 3, rows: 2 }
  const columns = Math.ceil(Math.sqrt(paneCount))
  return { columns, rows: Math.ceil(paneCount / columns) }
}
